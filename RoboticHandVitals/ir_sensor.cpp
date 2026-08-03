// =============================================================================
// ir_sensor.cpp — External IR Module Stubs (Deprecated)
// =============================================================================
// Note: Hand/Finger detection is now handled directly via the MAX30102
// integrated IR photodiode (see vitals.cpp -> isFingerDetectedOnOximeter()).
// =============================================================================

#include "ir_sensor.h"

void initIR() {
  // No external IR pin to initialize
}

bool isHandDetected() {
  return false;
}
