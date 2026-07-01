// =============================================================================
// servo_control.h — Soft-Start Servo Control
// =============================================================================
#ifndef SERVO_CONTROL_H
#define SERVO_CONTROL_H

// Attach servo to SERVO_PIN and move to the open (idle) position
void initServo();

// Ramp fingers from OPEN angle to CLOSE angle (soft close — safe for user)
void closeFingers();

// Ramp fingers from CLOSE angle back to OPEN angle
void openFingers();

#endif // SERVO_CONTROL_H
