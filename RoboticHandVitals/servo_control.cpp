// =============================================================================
// servo_control.cpp — Soft-Start Servo Control
// =============================================================================
// Hardware: SG90 / MG90S servo, single-signal tendon-driven finger actuation.
//
// ⚠️  POWER WARNING — READ THIS:
//   - Servo VCC → External 5V supply (NOT ESP32 3.3V or Vin!)
//   - Servo GND  → External supply GND AND ESP32 GND (common ground)
//   - Servo SIG  → GPIO13 (PWM signal only, no power)
//   Skipping the common GND will cause erratic servo behaviour or
//   corrupt ESP32 serial output.
//
// Servo PWM basics:
//   A standard hobby servo expects a 50 Hz PWM signal (period = 20 ms).
//   Pulse width of ~1000 µs → 0°, ~1500 µs → 90°, ~2000 µs → 180°.
//   The ESP32Servo library handles this; we just call servo.write(degrees).
//
// Soft-start ramp:
//   Instead of jumping directly to the target angle (which would jerk the
//   tendon and startle or hurt the person), we increment by 1° per step with
//   a configurable delay (SERVO_STEP_DELAY_MS). This creates a smooth ramp.
// =============================================================================

#include "servo_control.h"
#include "config.h"
#include <ESP32Servo.h>   // Install: "ESP32Servo" by Kevin Harrington v0.13.0

static Servo _servo;               // Global servo object (module-private)
static int   _currentAngle = SERVO_OPEN_DEG;  // Track current position

// --- Helpers ------------------------------------------------------------------

// Ramp the servo from its current angle to targetAngle, one degree at a time.
// direction: +1 = increasing angle (closing), -1 = decreasing (opening)
static void rampTo(int targetAngle) {
  int step = (_currentAngle < targetAngle) ? 1 : -1;

  while (_currentAngle != targetAngle) {
    _currentAngle += step;

    // servo.write() sends the PWM pulse for the given angle.
    // The ESP32Servo library maps this to the correct pulse width automatically.
    _servo.write(_currentAngle);

    // Wait between steps — this is what makes the motion smooth.
    // Reduce SERVO_STEP_DELAY_MS in config.h to move faster.
    delay(SERVO_STEP_DELAY_MS);
  }

  DBGF("[SERVO] Reached %d°\n", _currentAngle);
}

// --- Public functions ---------------------------------------------------------

void initServo() {
  // Allocate one of the ESP32's hardware timers for servo PWM.
  // ESP32Servo needs this call before attach().
  ESP32PWM::allocateTimer(0);

  // Attach the servo to the signal pin with standard pulse width range.
  // 500–2400 µs covers most hobby servos including SG90 and MG90S.
  _servo.setPeriodHertz(50);           // Standard 50 Hz servo signal
  _servo.attach(SERVO_PIN, 500, 2400); // Min/max pulse width in µs

  // Move immediately to open (idle) position on startup.
  _servo.write(SERVO_OPEN_DEG);
  _currentAngle = SERVO_OPEN_DEG;

  DBGLN("[SERVO] Initialised on pin " + String(SERVO_PIN) +
        ", open at " + String(SERVO_OPEN_DEG) + "°");
}

void closeFingers() {
  DBGLN("[SERVO] Closing fingers...");
  rampTo(SERVO_CLOSE_DEG);
}

void openFingers() {
  DBGLN("[SERVO] Opening fingers...");
  rampTo(SERVO_OPEN_DEG);
}
