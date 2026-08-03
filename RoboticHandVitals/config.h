// =============================================================================
// config.h — Robotic Hand Vitals Monitor
// =============================================================================
// ALL user-editable settings live here. You should not need to touch any other
// file to configure credentials, pins, or behaviour tuning.
// =============================================================================

#ifndef CONFIG_H
#define CONFIG_H

// ---------------------------------------------------------------------------
// Wi-Fi Feature Toggle (0 = Disabled / Standalone Offline, 1 = Enabled)
// ---------------------------------------------------------------------------
#define ENABLE_WIFI   0

// ---------------------------------------------------------------------------
// Wi-Fi Credentials (Used only if ENABLE_WIFI is set to 1)
// NOTE: ESP32 only supports 2.4 GHz Wi-Fi — 5 GHz networks will not connect.
// ---------------------------------------------------------------------------
#define WIFI_SSID     "AdornInn_2ndFloor"
#define WIFI_PASSWORD "AdorN@iNN123-3"

// ---------------------------------------------------------------------------
// Adafruit IO Credentials
// Get these from https://io.adafruit.com → My Key (top-right)
// ---------------------------------------------------------------------------
#define AIO_USERNAME  "YOUR_ADAFRUIT_IO_USERNAME"
#define AIO_KEY       "YOUR_ADAFRUIT_IO_KEY"


// ---------------------------------------------------------------------------
// Adafruit IO Feed Names
// These must match EXACTLY what you create on io.adafruit.com.
// Format: "username/feeds/feedname"
// ---------------------------------------------------------------------------
#define FEED_HEART_RATE  (String(AIO_USERNAME) + "/feeds/heart_rate")
#define FEED_SPO2        (String(AIO_USERNAME) + "/feeds/spo2")
#define FEED_TEMPERATURE (String(AIO_USERNAME) + "/feeds/temperature")

// ---------------------------------------------------------------------------
// Pin Definitions
// ---------------------------------------------------------------------------

// MAX30102 — I2C (Wire library uses these by default on ESP32 DevKit V1)
#define I2C_SDA_PIN   21
#define I2C_SCL_PIN   22

// IR Proximity Sensor (digital input, hand-detection on palm)
#define IR_PIN        4

// IR detect logic level:
//   LOW  = object detected (most common "active-LOW" modules)
//   HIGH = object detected (some modules invert the output)
// Flip this if your sensor behaves backwards.
#define IR_DETECT_LEVEL  LOW

// Servo signal pin (PWM — connect ONLY the signal wire here)
// ⚠️  POWER WARNING: Servo VCC must come from an EXTERNAL 5V supply,
//     NOT from the ESP32's 3.3V or onboard 5V pins. Only the signal
//     wire and a shared GND tie to the ESP32.
#define SERVO_PIN     13

// Placeholder pin for future external skin temperature sensor
// (DS18B20 one-wire OR MLX90614 I2C — depends on what you add later)
// Currently unused — see vitals.cpp > readSkinTemperature()
#define TEMP_PLACEHOLDER_PIN  5

// ---------------------------------------------------------------------------
// Servo Tuning Constants
// Adjust these for your specific servo, tendon tension, and finger geometry.
// ---------------------------------------------------------------------------

// Servo angle when fingers are fully OPEN (hand relaxed / IDLE state)
#define SERVO_OPEN_DEG    0

// Servo angle when fingers are fully CLOSED (hand gripping / FOLD state)
// Full 180-degree turn for gripping
#define SERVO_CLOSE_DEG   180

// Delay between each 1° step during soft-start ramp (milliseconds).
// Higher = slower / gentler motion.  Lower = faster / more abrupt.
// 15 ms → ~2.7 seconds for a full 180° sweep.
#define SERVO_STEP_DELAY_MS  15

// Raw MAX30102 IR reading threshold to detect finger placement on the pulse oximeter
// When a finger is pressed on the sensor glass, raw IR reading typically exceeds 50,000.
#define OXIMETER_FINGER_THRESHOLD  50000L

// ---------------------------------------------------------------------------
// IR Debounce
// How long the IR sensor must continuously read "detected" before we
// accept it as a real hand placement (filters out brief reflections).
// ---------------------------------------------------------------------------
#define IR_DEBOUNCE_MS    200   // 200 ms steady detection required

// ---------------------------------------------------------------------------
// Measurement Parameters
// ---------------------------------------------------------------------------

// Number of samples to collect per vitals reading cycle
#define MEASURE_SAMPLES       3

// Delay between individual samples (milliseconds)
// 3 samples × 2000 ms ≈ 6 seconds total measurement window
#define MEASURE_INTERVAL_MS   2000

// How long the MAX30102 needs to stabilise after mode change (ms)
#define SENSOR_SETTLE_MS      1500

// ---------------------------------------------------------------------------
// Hold and Fail-safe Timers
// ---------------------------------------------------------------------------

// How long to keep fingers closed AFTER publishing vitals (ms)
#define HOLD_DURATION_MS      5000   // 5 seconds

// How long to wait AFTER unfolding fingers before allowing a new hand detection (ms)
#define COOLDOWN_DURATION_MS  5000   // 5 seconds cooldown delay

// Absolute maximum time any single state can run before the fail-safe
// forces an UNFOLD. Prevents the hand staying closed if anything hangs.
#define FAILSAFE_TIMEOUT_MS   30000  // 30 seconds

// ---------------------------------------------------------------------------
// Serial Debug
// Set to 0 to silence all debug prints (e.g. for a demo/production run)
// ---------------------------------------------------------------------------
#define DEBUG_SERIAL  1

#if DEBUG_SERIAL
  #define DBG(msg)       Serial.print(msg)
  #define DBGLN(msg)     Serial.println(msg)
  #define DBGF(fmt, ...) Serial.printf(fmt, ##__VA_ARGS__)
#else
  #define DBG(msg)
  #define DBGLN(msg)
  #define DBGF(fmt, ...)
#endif

#endif // CONFIG_H
