// =============================================================================
// RoboticHandVitals.ino — Main Sketch & Finite State Machine (FSM)
// =============================================================================
// Flow: IDLE -> FOLD -> MEASURE -> PUBLISH -> HOLD -> UNFOLD -> IDLE
// =============================================================================

#include "config.h"
#include "ir_sensor.h"
#include "servo_control.h"
#include "vitals.h"
#include "adafruit_io_helper.h"

enum State {
  STATE_IDLE,
  STATE_FOLD,
  STATE_MEASURE,
  STATE_PUBLISH,
  STATE_HOLD,
  STATE_UNFOLD
};

static State currentState = STATE_IDLE;
static unsigned long stateTimer = 0;

void changeState(State newState, const char* stateName) {
  currentState = newState;
  stateTimer = millis();
  DBGF("[FSM] Entering state: %s\n", stateName);
}

void setup() {
#if DEBUG_SERIAL
  Serial.begin(115200);
  delay(1000);
  DBGLN("=========================================");
  DBGLN("   Robotic Hand Vitals Monitor Starting  ");
  DBGLN("=========================================");
#endif

  initIR();
  initServo();

  if (!initVitals()) {
    DBGLN("[SETUP] WARNING: MAX30102 Vitals sensor init failed!");
  }

  connectWiFi();

  changeState(STATE_IDLE, "IDLE");
}

void loop() {
  processAdafruitIO();

  // Fail-safe timeout check
  if (currentState != STATE_IDLE && (millis() - stateTimer) > FAILSAFE_TIMEOUT_MS) {
    DBGLN("[FAILSAFE] State timeout reached! Unfolding fingers for safety...");
    openFingers();
    changeState(STATE_IDLE, "IDLE");
    return;
  }

  switch (currentState) {
    case STATE_IDLE:
      if (isHandDetected()) {
        DBGLN("[FSM] Hand detected on palm IR sensor!");
        changeState(STATE_FOLD, "FOLD");
      }
      break;

    case STATE_FOLD:
      closeFingers();
      changeState(STATE_MEASURE, "MEASURE");
      break;

    case STATE_MEASURE: {
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
      changeState(STATE_IDLE, "IDLE");
      break;

    default:
      openFingers();
      changeState(STATE_IDLE, "IDLE");
      break;
  }

  delay(10);
}
