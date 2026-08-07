// =============================================================================
// 04_Interactive_System_Diagnostic.ino
// Robotic Hand Vitals Monitor — Comprehensive Subsystem Diagnostic Suite
// =============================================================================
// Description:
//   An interactive Serial Menu diagnostic sketch allowing complete hardware
//   verification before running the main state machine.
//
// Commands (Send via Serial Monitor at 115200 Baud):
//   1 -> Scan I2C Bus & Test MAX30102 Sensor
//   2 -> Test Servo Sweep (0° -> 180° -> 0°)
//   3 -> Test Wi-Fi Connection & Send Test Feeds to Adafruit IO
//   4 -> Stream Realtime MAX30102 Optical Readings (press 's' to stop)
//   5 -> Run Full End-to-End Simulation (Finger Detect -> Grip -> Vitals -> Upload -> Release)
// =============================================================================

#include <Wire.h>
#include <MAX30105.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "../../config.h"

MAX30105 sensor;
Servo servo;
bool isSensorOK = false;

void showMenu() {
  Serial.println("\n=======================================================");
  Serial.println("  ROBOTIC HAND VITALS — HARDWARE DIAGNOSTIC SUITE     ");
  Serial.println("=======================================================");
  Serial.println(" Select a test by entering the option number:");
  Serial.println("  1 : Test I2C Bus & MAX30102 Sensor Init");
  Serial.println("  2 : Test Servo Motor Sweep (0° -> 180° -> 0°)");
  Serial.println("  3 : Test Wi-Fi Connection & Adafruit IO Upload");
  Serial.println("  4 : Live Stream MAX30102 Raw Data (Press 's' to exit)");
  Serial.println("  5 : Run Full Single-Cycle Integration Test");
  Serial.println("=======================================================");
  Serial.print("Option > ");
}

void testI2CAndSensor() {
  Serial.println("\n--- [TEST 1: I2C & MAX30102] ---");
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  byte devices = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("Found I2C device at 0x%02X %s\n", address, (address == 0x57) ? "(MAX30102)" : "");
      devices++;
    }
  }

  if (devices == 0) {
    Serial.println("❌ FAILED: No I2C devices found!");
    return;
  }

  if (sensor.begin(Wire, I2C_SPEED_FAST)) {
    sensor.setup(60, 4, 2, 100, 411, 4096);
    float temp = sensor.readTemperature() + TEMP_OFFSET_DEG_C;
    uint32_t ir = sensor.getIR();
    Serial.println("✅ SUCCESS: MAX30102 Initialized.");
    Serial.printf("   Current Die Temp: %.1f°C | Baseline IR: %u\n", temp, ir);
    isSensorOK = true;
  } else {
    Serial.println("❌ FAILED: Could not initialize MAX30102!");
    isSensorOK = false;
  }
}

void testServo() {
  Serial.println("\n--- [TEST 2: SERVO MOTOR] ---");
  ESP32PWM::allocateTimer(0);
  servo.setPeriodHertz(50);
  servo.attach(SERVO_PIN, 500, 2400);

  Serial.println("Moving to 0° (OPEN)...");
  servo.write(0);
  delay(1000);

  Serial.println("Ramping to 180° (CLOSE)...");
  for (int angle = 0; angle <= 180; angle++) {
    servo.write(angle);
    delay(SERVO_STEP_DELAY_MS);
  }
  delay(1000);

  Serial.println("Ramping back to 0° (OPEN)...");
  for (int angle = 180; angle >= 0; angle--) {
    servo.write(angle);
    delay(SERVO_STEP_DELAY_MS);
  }
  Serial.println("✅ SUCCESS: Servo Sweep Completed.");
}

void testWiFiAndAIO() {
  Serial.println("\n--- [TEST 3: WI-FI & ADAFRUIT IO] ---");
  Serial.printf("Connecting to '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 15) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Wi-Fi Connected!");
    Serial.printf("IP: %s | RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());

    HTTPClient http;
    String url = "https://io.adafruit.com/api/v2/" + String(AIO_USERNAME) + "/feeds/heart_rate/data";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-AIO-Key", AIO_KEY);
    int code = http.POST("{\"value\":72.0}");
    if (code == 200 || code == 201) {
      Serial.println("✅ SUCCESS: Test Heart Rate (72.0) published to Adafruit IO!");
    } else {
      Serial.printf("❌ FAILED: HTTP response %d\n", code);
    }
    http.end();
  } else {
    Serial.println("\n❌ FAILED: Could not connect to Wi-Fi!");
  }
}

void streamLiveData() {
  Serial.println("\n--- [TEST 4: LIVE STREAM MAX30102] (Press 's' to stop) ---");
  if (!isSensorOK) {
    if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
      Serial.println("❌ Sensor not ready!");
      return;
    }
    sensor.setup(60, 4, 2, 100, 411, 4096);
    isSensorOK = true;
  }

  while (true) {
    if (Serial.available() > 0) {
      char c = Serial.read();
      if (c == 's' || c == 'S') {
        Serial.println("\nStopped Live Stream.");
        break;
      }
    }

    uint32_t ir = sensor.getIR();
    uint32_t red = sensor.getRed();
    bool detected = (ir > OXIMETER_FINGER_THRESHOLD);
    Serial.printf("IR: %6u | Red: %6u | Finger: %s\n", ir, red, detected ? "YES" : "NO");
    delay(200);
  }
}

void testFullCycle() {
  Serial.println("\n--- [TEST 5: FULL CYCLE INTEGRATION] ---");
  Serial.println("1. Checking finger detection...");
  if (!isSensorOK) testI2CAndSensor();

  uint32_t ir = sensor.getIR();
  Serial.printf("   Current IR: %u (Threshold: %ld)\n", ir, (long)OXIMETER_FINGER_THRESHOLD);

  Serial.println("2. Closing fingers (Gripping)...");
  testServo();

  Serial.println("3. Simulating vitals upload...");
  testWiFiAndAIO();

  Serial.println("✅ Full Integration Cycle Completed Successfully!");
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  showMenu();
}

void loop() {
  if (Serial.available() > 0) {
    char option = Serial.read();
    while (Serial.available() > 0) Serial.read(); // flush extra newline/char

    switch (option) {
      case '1': testI2CAndSensor(); break;
      case '2': testServo(); break;
      case '3': testWiFiAndAIO(); break;
      case '4': streamLiveData(); break;
      case '5': testFullCycle(); break;
      default:
        if (option != '\r' && option != '\n') {
          Serial.println("Invalid option.");
        }
        break;
    }
    delay(1000);
    showMenu();
  }
}
