// =============================================================================
// RoboticHandVitals.ino — Main Sketch & Finite State Machine (FSM)
// =============================================================================
// Flow: IDLE -> FOLD -> MEASURE -> HOLD -> UNFOLD -> COOLDOWN -> IDLE
// =============================================================================

#include "config.h"
#include "servo_control.h"
#include "vitals.h"
#include "adafruit_io_helper.h"

enum State {
  STATE_IDLE,
  STATE_FOLD,
  STATE_MEASURE,
  STATE_PUBLISH,
  STATE_HOLD,
  STATE_UNFOLD,
  STATE_COOLDOWN
};

static State currentState = STATE_IDLE;
static unsigned long stateTimer = 0;

void changeState(State newState, const char* stateName) {
  currentState = newState;
  stateTimer = millis();
  DBGF("[FSM] Entering state: %s\n", stateName);
  Serial.printf("{\"type\":\"fsm\",\"state\":\"%s\"}\n", stateName);
#if ENABLE_WIFI
  publishState(stateName);
#endif
}

void setup() {
#if DEBUG_SERIAL
  Serial.begin(115200);
  delay(1000);
  DBGLN("=========================================");
  DBGLN("   Robotic Hand Vitals Monitor Starting  ");
  DBGLN("=========================================");
#endif

  initServo();

  if (!initVitals()) {
    DBGLN("[SETUP] WARNING: MAX30102 Vitals sensor init failed!");
  }

#if ENABLE_WIFI
  connectWiFi();
#else
  DBGLN("[SETUP] Operating in Standalone Offline Mode (Wi-Fi disabled)");
#endif

  changeState(STATE_IDLE, "IDLE");
}

void handleSerialCommands() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.indexOf("\"cmd\":\"fold\"") >= 0 || cmd == "fold") {
      DBGLN("[SERIAL CMD] Manual Fold triggered from Dashboard");
      changeState(STATE_FOLD, "FOLD");
    } else if (cmd.indexOf("\"cmd\":\"unfold\"") >= 0 || cmd == "unfold") {
      DBGLN("[SERIAL CMD] Manual Unfold triggered from Dashboard");
      changeState(STATE_UNFOLD, "UNFOLD");
    } else if (cmd.indexOf("\"cmd\":\"measure\"") >= 0 || cmd == "measure") {
      DBGLN("[SERIAL CMD] Manual Measure triggered from Dashboard");
      changeState(STATE_MEASURE, "MEASURE");
    } else if (cmd.indexOf("\"cmd\":\"servo\"") >= 0) {
      int idx = cmd.indexOf("\"angle\":");
      if (idx >= 0) {
        int angle = cmd.substring(idx + 8).toInt();
        DBGF("[SERIAL CMD] Manual Servo Angle set: %d°\n", angle);
        setServoAngle(angle);
      }
    }
  }
}

void loop() {
  handleSerialCommands();

#if ENABLE_WIFI
  processAdafruitIO();
#endif

  // Fail-safe timeout check
  if (currentState != STATE_IDLE && (millis() - stateTimer) > FAILSAFE_TIMEOUT_MS) {
    DBGLN("[FAILSAFE] State timeout reached! Unfolding fingers for safety...");
    openFingers();
    changeState(STATE_IDLE, "IDLE");
    return;
  }

  switch (currentState) {
    case STATE_IDLE:
      if (isFingerDetectedOnOximeter()) {
        DBGLN("[FSM] Hand/Finger detected on MAX30102 IR photodiode! Moving servo to fold fingers...");
        changeState(STATE_FOLD, "FOLD");
      }
      break;

    case STATE_FOLD:
      closeFingers();
      changeState(STATE_MEASURE, "MEASURE");
      break;

    case STATE_MEASURE:
      {
        VitalsReading reading = collectAndAverageVitals();
        if (reading.valid) {
          publishVitals(reading);
          changeState(STATE_HOLD, "HOLD");
        } else {
          DBGLN("[FSM] Vitals reading invalid or low confidence.");
          changeState(STATE_UNFOLD, "UNFOLD");
        }
        break;
      }

    case STATE_HOLD:
      if (millis() - stateTimer >= HOLD_DURATION_MS) {
        changeState(STATE_UNFOLD, "UNFOLD");
      }
      break;

    case STATE_UNFOLD:
      openFingers();
      changeState(STATE_COOLDOWN, "COOLDOWN");
      break;

    case STATE_COOLDOWN:
      if (millis() - stateTimer >= COOLDOWN_DURATION_MS) {
        DBGLN("[FSM] Cooldown delay completed. Ready for next hand placement.");
        changeState(STATE_IDLE, "IDLE");
      }
      break;

    default:
      openFingers();
      changeState(STATE_IDLE, "IDLE");
      break;
  }

  delay(10);
}
