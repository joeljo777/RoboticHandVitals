// =============================================================================
// ir_sensor.h — IR Proximity Sensor (Hand Detection)
// =============================================================================
#ifndef IR_SENSOR_H
#define IR_SENSOR_H

// Initialise the IR sensor pin
void initIR();

// Returns true if a hand has been continuously detected for IR_DEBOUNCE_MS.
// Call this from the IDLE state loop — it is non-blocking (uses millis()).
bool isHandDetected();

#endif // IR_SENSOR_H
