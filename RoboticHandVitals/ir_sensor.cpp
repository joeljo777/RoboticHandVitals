// =============================================================================
// ir_sensor.cpp — IR Proximity Sensor (Hand Detection)
// =============================================================================
// Hardware: Generic IR proximity module with digital OUT pin.
//
// How it works:
//   The IR module has an emitter LED and a receiver photodiode. When an object
//   (hand) is close, reflected IR light triggers the receiver, pulling OUT low
//   (or high — depends on the module). We read that digital level.
//
// Debounce:
//   A single digital read can glitch. We require the signal to stay stable for
//   IR_DEBOUNCE_MS milliseconds before reporting "hand detected". This prevents
//   false triggers from brief reflections or electrical noise.
// =============================================================================

#include "ir_sensor.h"
#include "config.h"
#include <Arduino.h>

// --- Module-private state -----------------------------------------------------
static unsigned long _detectStartMs = 0;   // When continuous detection began
static bool          _detecting     = false; // Whether we're in a detection run

// --- Public functions ---------------------------------------------------------

void initIR() {
  // Configure the IR sensor pin as a digital input.
  // INPUT_PULLUP adds a weak internal pull-up resistor — useful if your module
  // floats the pin when no hand is detected (active-low modules).
  // Remove INPUT_PULLUP and use plain INPUT if your module has its own pull-up.
  pinMode(IR_PIN, INPUT_PULLUP);

  DBGLN("[IR] Sensor initialised on pin " + String(IR_PIN));
}

bool isHandDetected() {
  // Read the raw digital level from the IR sensor pin.
  // digitalRead() returns HIGH (1) or LOW (0).
  int level = digitalRead(IR_PIN);

  if (level == IR_DETECT_LEVEL) {
    // Signal is in the "hand present" state —
    if (!_detecting) {
      // This is the start of a new potential detection event.
      // Record the timestamp and set the tracking flag.
      _detecting     = true;
      _detectStartMs = millis();
    } else {
      // We're already tracking a detection event.
      // Check if it has lasted long enough to be considered real.
      if ((millis() - _detectStartMs) >= IR_DEBOUNCE_MS) {
        // Debounce window satisfied — hand is genuinely present.
        return true;
      }
    }
  } else {
    // Signal returned to "no hand" level — reset the debounce state.
    _detecting     = false;
    _detectStartMs = 0;
  }

  return false;  // Not yet confirmed
}
