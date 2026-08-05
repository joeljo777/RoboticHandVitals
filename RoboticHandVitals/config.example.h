// =============================================================================
// config.example.h — Template Configuration File
// =============================================================================
// Copy this file to "config.h" and insert your real Wi-Fi and Adafruit IO keys.
// "config.h" is ignored by Git to keep your private credentials safe!
// =============================================================================

#ifndef CONFIG_H
#define CONFIG_H

// ---------------------------------------------------------------------------
// Wi-Fi Feature Toggle (0 = Disabled / Standalone Offline, 1 = Enabled)
// ---------------------------------------------------------------------------
#define ENABLE_WIFI   1

// ---------------------------------------------------------------------------
// Wi-Fi Credentials (Used only if ENABLE_WIFI is set to 1)
// NOTE: ESP32 only supports 2.4 GHz Wi-Fi — 5 GHz networks will not connect.
// ---------------------------------------------------------------------------
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ---------------------------------------------------------------------------
// Adafruit IO Credentials
// Get these from https://io.adafruit.com → My Key (top-right)
// ---------------------------------------------------------------------------
#define AIO_USERNAME  "YOUR_ADAFRUIT_IO_USERNAME"
#define AIO_KEY       "YOUR_ADAFRUIT_IO_KEY"

// ---------------------------------------------------------------------------
// Adafruit IO Feed Names
// ---------------------------------------------------------------------------
#define FEED_HEART_RATE  (String(AIO_USERNAME) + "/feeds/heart_rate")
#define FEED_SPO2        (String(AIO_USERNAME) + "/feeds/spo2")
#define FEED_TEMPERATURE (String(AIO_USERNAME) + "/feeds/temperature")

// ---------------------------------------------------------------------------
// Pin Definitions & Hardware Connections
// ---------------------------------------------------------------------------
#define I2C_SDA_PIN   21
#define I2C_SCL_PIN   22
#define SERVO_PWM_PIN 13

// ---------------------------------------------------------------------------
// FSM Timing Delays
// ---------------------------------------------------------------------------
#define HOLD_DURATION_MS       3000
#define COOLDOWN_DURATION_MS   3000
#define FAILSAFE_TIMEOUT_MS   30000

// ---------------------------------------------------------------------------
// Calibration Offsets
// ---------------------------------------------------------------------------
#define TEMP_OFFSET_DEG_C     4.2f

// ---------------------------------------------------------------------------
// Debug & Serial Output
// ---------------------------------------------------------------------------
#define DEBUG_SERIAL  1

#if DEBUG_SERIAL
  #define DBGLN(x)  Serial.println(x)
  #define DBGF(...) Serial.printf(__VA_ARGS__)
#else
  #define DBGLN(x)
  #define DBGF(...)
#endif

#endif // CONFIG_H
