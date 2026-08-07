// =============================================================================
// 01_I2C_MAX30102_Diagnostic.ino
// Robotic Hand Vitals Monitor — MAX30102 & I2C Sensor Diagnostic Tool
// =============================================================================
// Description:
//   1. Scans the I2C bus on GPIO21 (SDA) and GPIO22 (SCL) to find MAX30102 (0x57).
//   2. Initialises the MAX30102 sensor.
//   3. Reads raw Red and IR values continuously to check optical reflection.
//   4. Tests finger placement threshold (>50,000 raw IR).
//   5. Reads die temperature from MAX30102.
// =============================================================================

#include <Wire.h>
#include <MAX30105.h>

#define I2C_SDA_PIN              21
#define I2C_SCL_PIN              22
#define OXIMETER_FINGER_THRESHOLD 50000L
#define TEMP_OFFSET_DEG_C        4.2f

MAX30105 sensor;
bool sensorFound = false;

void scanI2CBus() {
  Serial.println("\n-------------------------------------------");
  Serial.println("[I2C SCANNER] Scanning I2C bus (SDA:21, SCL:22)...");
  byte count = 0;
  
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.printf("[I2C SCANNER] Device found at address 0x%02X", address);
      if (address == 0x57) {
        Serial.print("  <-- MAX30102 Pulse Oximeter!");
      }
      Serial.println();
      count++;
    }
  }

  if (count == 0) {
    Serial.println("[I2C SCANNER] ⚠️ NO I2C devices found! Check 3.3V, GND, SDA(21), SCL(22) wiring.");
  } else {
    Serial.printf("[I2C SCANNER] Scan complete. Found %d device(s).\n", count);
  }
  Serial.println("-------------------------------------------\n");
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n==================================================");
  Serial.println("   MAX30102 & I2C DIAGNOSTIC TOOL STARTED         ");
  Serial.println("==================================================");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  
  // Step 1: Scan I2C
  scanI2CBus();

  // Step 2: Init MAX30102
  Serial.println("[MAX30102] Attempting to initialize MAX30102 sensor...");
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[MAX30102] ❌ ERROR: MAX30102 sensor not found on I2C bus!");
    sensorFound = false;
  } else {
    Serial.println("[MAX30102] ✅ Sensor initialized successfully!");
    // Setup sensor: brightness 60, sampleAverage 4, ledMode 2 (Red+IR), sampleRate 100, pulseWidth 411, adcRange 4096
    sensor.setup(60, 4, 2, 100, 411, 4096);
    sensorFound = true;
  }
}

void loop() {
  if (!sensorFound) {
    Serial.println("[MAX30102] Sensor unavailable. Retrying in 5 seconds...");
    delay(5000);
    scanI2CBus();
    if (sensor.begin(Wire, I2C_SPEED_FAST)) {
      sensor.setup(60, 4, 2, 100, 411, 4096);
      sensorFound = true;
    }
    return;
  }

  uint32_t irValue = sensor.getIR();
  uint32_t redValue = sensor.getRed();
  float rawTemp = sensor.readTemperature();
  float tempC = rawTemp + TEMP_OFFSET_DEG_C;

  bool fingerDetected = (irValue > OXIMETER_FINGER_THRESHOLD);

  Serial.printf("[READING] IR: %6u | Red: %6u | Temp: %.1f°C | Finger Detected: %s\n",
                irValue, redValue, tempC, fingerDetected ? "YES (DETECTED)" : "NO");

  delay(500);
}
