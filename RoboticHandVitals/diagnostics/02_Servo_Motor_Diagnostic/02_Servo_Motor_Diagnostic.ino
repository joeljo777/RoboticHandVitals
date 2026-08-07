// =============================================================================
// 02_Servo_Motor_Diagnostic.ino
// Robotic Hand Vitals Monitor — Servo Motor Diagnostic & Sweep Tool
// =============================================================================
// Description:
//   1. Tests PWM servo control on GPIO 13.
//   2. Sweeps servo from 0° (OPEN) to 180° (CLOSE) with soft ramping.
//   3. Accepts Serial Commands (0, 45, 90, 135, 180, sweep) to test angles manually.
//
// ⚠️ POWER WARNING:
//   - Connect Servo VCC to External 5V power supply.
//   - Tie External 5V GND to ESP32 GND (Common Ground).
//   - Signal wire ONLY connected to GPIO 13.
// =============================================================================

#include <ESP32Servo.h>

#define SERVO_PIN            13
#define SERVO_OPEN_DEG       0
#define SERVO_CLOSE_DEG      180
#define SERVO_STEP_DELAY_MS  15

Servo testServo;
int currentAngle = SERVO_OPEN_DEG;

void rampToAngle(int targetAngle) {
  targetAngle = constrain(targetAngle, 0, 180);
  Serial.printf("[SERVO DIAG] Ramping from %d° to %d°...\n", currentAngle, targetAngle);
  int step = (currentAngle < targetAngle) ? 1 : -1;

  while (currentAngle != targetAngle) {
    currentAngle += step;
    testServo.write(currentAngle);
    delay(SERVO_STEP_DELAY_MS);
  }
  Serial.printf("[SERVO DIAG] Completed. Current Position: %d°\n", currentAngle);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n==================================================");
  Serial.println("   SERVO MOTOR DIAGNOSTIC & SWEEP TOOL STARTED    ");
  Serial.println("==================================================");
  Serial.println("Commands:");
  Serial.println("  Type '0'     -> Set servo to 0° (Open)");
  Serial.println("  Type '90'    -> Set servo to 90° (Halfway)");
  Serial.println("  Type '180'   -> Set servo to 180° (Closed/Gripping)");
  Serial.println("  Type 'sweep' -> Run full sweep 0° -> 180° -> 0°");
  Serial.println("  Type any number 0..180 -> Go to specific angle");
  Serial.println("--------------------------------------------------\n");

  ESP32PWM::allocateTimer(0);
  testServo.setPeriodHertz(50);
  testServo.attach(SERVO_PIN, 500, 2400);

  Serial.printf("[SERVO DIAG] Attached on GPIO%d. Setting to initial OPEN (%d°)...\n", SERVO_PIN, SERVO_OPEN_DEG);
  testServo.write(SERVO_OPEN_DEG);
  currentAngle = SERVO_OPEN_DEG;
}

void loop() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();

    if (input.equalsIgnoreCase("sweep")) {
      Serial.println("[SERVO DIAG] Running full sweep test...");
      rampToAngle(SERVO_CLOSE_DEG);
      delay(1000);
      rampToAngle(SERVO_OPEN_DEG);
    } else if (input.length() > 0) {
      int angle = input.toInt();
      rampToAngle(angle);
    }
  }
}
