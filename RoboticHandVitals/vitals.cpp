// =============================================================================
// vitals.cpp — MAX30102 Vital Signs Reading
// =============================================================================
// Hardware: MAX30102 Pulse Oximeter / Heart Rate sensor (I2C)
//   VIN  → 3.3V (the module has an onboard LDO; some modules also accept 5V)
//   GND  → GND
//   SDA  → GPIO21
//   SCL  → GPIO22
//
// I2C basics:
//   I2C is a 2-wire serial bus. SDA is data, SCL is the clock. The master
//   (ESP32) sends a 7-bit address (MAX30102 = 0x57) to select the device,
//   then reads/writes registers. Wire.begin() initialises the I2C peripheral.
//
// How MAX30102 measures HR & SpO2:
//   The sensor has red and infrared LEDs. It fires them alternately and
//   measures how much light passes through (or reflects from) tissue.
//   Pulsatile blood flow changes the optical absorption — this is the PPG
//   (photoplethysmography) signal. The SparkFun library processes it to
//   extract heart rate and SpO2.
//
// ⚠️  Accuracy note:
//   Reliable readings require the finger/palm to be still and pressed gently
//   against the sensor window. Movement produces motion artifacts. The
//   SparkFun library internally checks a "confidence" value — we filter out
//   low-confidence readings.
// =============================================================================

#include "vitals.h"
#include "config.h"
#include <Wire.h>
#include <SparkFun_MAX3010x_Sensor_Library.h>  // SparkFun MAX3010x v1.1.2

// The SparkFun library wraps the MAX30102 register map.
static MAX30105 _sensor;

// How many samples the library collects internally per measurement call.
// More samples = more averaging inside the library = smoother result.
#define FIFO_SAMPLES_PER_READ  100

// Minimum confidence the library must report before we accept a reading.
// Range: 0–100. Below this → reading is discarded and averaged from the rest.
#define MIN_CONFIDENCE  25

// --- Public functions ---------------------------------------------------------

bool initVitals() {
  // Initialise the I2C bus with the correct SDA/SCL pins for ESP32.
  // The default Wire.begin() on ESP32 uses GPIO21 (SDA) and GPIO22 (SCL).
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // Attempt to find and initialise the MAX30102.
  // begin() scans the I2C bus for the sensor at address 0x57.
  if (!_sensor.begin(Wire, I2C_SPEED_FAST)) {
    // I2C_SPEED_FAST = 400 kHz — MAX30102 supports up to 400 kHz.
    DBGLN("[VITALS] ERROR: MAX30102 not found. Check wiring and I2C address.");
    return false;
  }

  // Configure sensor for heart rate + SpO2 mode.
  // setup() sets LED brightness, sample rate, pulse width, and ADC range.
  // These defaults work well for fingertip / palm placement:
  //   ledBrightness = 60     (0–255, higher = more LED power, more heat)
  //   sampleAverage = 4      (average 4 raw samples per FIFO slot)
  //   ledMode       = 2      (mode 2 = Red + IR LEDs for SpO2)
  //   sampleRate    = 100    (100 samples/sec from sensor)
  //   pulseWidth    = 411    (411 µs LED pulse — good for SpO2)
  //   adcRange      = 4096   (full scale ADC range)
  _sensor.setup(60, 4, 2, 100, 411, 4096);

  // After setup, allow the LEDs and photodiode to settle.
  delay(SENSOR_SETTLE_MS);

  DBGLN("[VITALS] MAX30102 initialised OK");
  return true;
}

// ---------------------------------------------------------------------------
// readSkinTemperature()
// ---------------------------------------------------------------------------
// ⚠️  STUB — Currently returns 0.0f.
//
// When you are ready to add a real skin temperature sensor:
//
// Option A — DS18B20 (OneWire, digital, ±0.5°C):
//   #include <OneWire.h>
//   #include <DallasTemperature.h>
//   OneWire oneWire(TEMP_PLACEHOLDER_PIN);
//   DallasTemperature sensors(&oneWire);
//   float readSkinTemperature() {
//     sensors.requestTemperatures();
//     return sensors.getTempCByIndex(0);
//   }
//
// Option B — MLX90614 (I2C, non-contact, ±0.5°C):
//   #include <Adafruit_MLX90614.h>
//   Adafruit_MLX90614 mlx;
//   float readSkinTemperature() {
//     return mlx.readObjectTempC();  // skin surface
//   }
// ---------------------------------------------------------------------------
float readSkinTemperature() {
  // TODO: Replace with real sensor read (see comments above)
  DBGLN("[VITALS] Temperature: STUB — returning 0.0 (no sensor wired yet)");
  return 0.0f;
}

// ---------------------------------------------------------------------------
// collectAndAverageVitals()
// ---------------------------------------------------------------------------
// Takes MEASURE_SAMPLES readings spaced MEASURE_INTERVAL_MS apart.
// Each reading uses the SparkFun library's built-in averaging.
// Returns a VitalsReading with averaged values, or valid=false if all failed.
// ---------------------------------------------------------------------------
VitalsReading collectAndAverageVitals() {
  float totalHR   = 0.0f;
  float totalSpO2 = 0.0f;
  float totalTemp = 0.0f;
  int   validCount = 0;

  DBGF("[VITALS] Collecting %d samples...\n", MEASURE_SAMPLES);

  for (int i = 0; i < MEASURE_SAMPLES; i++) {
    DBGF("[VITALS] Sample %d/%d\n", i + 1, MEASURE_SAMPLES);

    // The SparkFun library calculates HR and SpO2 from a batch of FIFO data.
    // We need to feed it raw samples by calling check() in a tight loop,
    // then call the calculation functions to get results.

    // Reset the FIFO buffer before each sample to avoid stale data.
    _sensor.clearFIFO();

    // Collect enough raw samples for the library's algorithm.
    // Each check() call reads any new data sitting in the sensor's FIFO buffer
    // (up to 32 slots, each holding one red + one IR reading).
    long redBuffer[FIFO_SAMPLES_PER_READ];
    long irBuffer[FIFO_SAMPLES_PER_READ];

    for (int j = 0; j < FIFO_SAMPLES_PER_READ; j++) {
      // Wait until the sensor has a new sample ready (polls the FIFO)
      while (_sensor.available() == false) {
        _sensor.check(); // Ask sensor to fill its software FIFO from hardware FIFO
      }
      // Pop one sample from the software FIFO
      redBuffer[j] = _sensor.getRed();  // Red LED intensity (for SpO2 calc)
      irBuffer[j]  = _sensor.getIR();   // IR LED intensity (for HR calc)
      _sensor.nextSample();             // Move FIFO read pointer forward
    }

    // Calculate SpO2 and heart rate from the collected buffers.
    // The library uses a signal-processing algorithm on the raw PPG data.
    int32_t  spo2;        // Calculated SpO2 (%)
    int8_t   spo2Valid;   // 1 = valid result, 0 = failed (e.g. no finger)
    int32_t  hr;          // Calculated heart rate (BPM)
    int8_t   hrValid;     // 1 = valid result, 0 = failed
    int8_t   hrConfidence; // 0–100 confidence score from the HR algorithm

    // maxim_heart_rate_and_oxygen_saturation() is the core algorithm from
    // Maxim Integrated (now Analog Devices), bundled in the SparkFun library.
    maxim_heart_rate_and_oxygen_saturation(
      (uint32_t*)irBuffer,   // IR buffer (primary input for HR)
      FIFO_SAMPLES_PER_READ,
      (uint32_t*)redBuffer,  // Red buffer (used for SpO2 ratio)
      &spo2, &spo2Valid,
      &hr,   &hrValid,
      &hrConfidence
    );

    // Read temperature (stub for now — see readSkinTemperature() above)
    float temp = readSkinTemperature();

    DBGF("[VITALS] HR=%ld (valid=%d, confidence=%d), SpO2=%ld (valid=%d), Temp=%.1f\n",
         hr, hrValid, hrConfidence, spo2, spo2Valid, temp);

    // Accept this reading if:
    //   1. Both HR and SpO2 are flagged valid by the library
    //   2. HR confidence meets our minimum threshold
    //   3. Values are in physiologically plausible ranges
    bool plausible = (hr > 40 && hr < 200) && (spo2 > 70 && spo2 <= 100);

    if (hrValid && spo2Valid && hrConfidence >= MIN_CONFIDENCE && plausible) {
      totalHR   += (float)hr;
      totalSpO2 += (float)spo2;
      totalTemp += temp;
      validCount++;
      DBGLN("[VITALS] Sample accepted.");
    } else {
      DBGLN("[VITALS] Sample rejected (low confidence or out-of-range).");
    }

    // Wait before next sample (unless it's the last one)
    if (i < MEASURE_SAMPLES - 1) {
      delay(MEASURE_INTERVAL_MS);
    }
  }

  // Build the result
  VitalsReading result;

  if (validCount > 0) {
    result.heartRate   = totalHR   / validCount;
    result.spO2        = totalSpO2 / validCount;
    result.temperature = totalTemp / validCount;
    result.valid       = true;
    DBGF("[VITALS] Averaged (%d valid samples): HR=%.1f BPM, SpO2=%.1f%%, Temp=%.1f°C\n",
         validCount, result.heartRate, result.spO2, result.temperature);
  } else {
    // All samples failed — return invalid result; state machine will fail-safe
    result.heartRate   = 0.0f;
    result.spO2        = 0.0f;
    result.temperature = 0.0f;
    result.valid       = false;
    DBGLN("[VITALS] ERROR: All samples invalid — no usable reading.");
  }

  return result;
}
