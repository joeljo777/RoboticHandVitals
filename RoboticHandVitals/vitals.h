// =============================================================================
// vitals.h — MAX30102 Vital Signs Reading
// =============================================================================
#ifndef VITALS_H
#define VITALS_H

#include <Arduino.h>

// Result struct — holds one averaged vitals reading
struct VitalsReading {
  float heartRate;    // Beats per minute (BPM)
  float spO2;         // Oxygen saturation (%)
  float temperature;  // Skin temp °C — stub until real sensor wired in
  bool  valid;        // false if sensor returned garbage/timeout
};

// Initialise I2C and the MAX30102 sensor
bool initVitals();

// Collect MEASURE_SAMPLES readings spaced MEASURE_INTERVAL_MS apart,
// then return the averaged result. Blocking call (~6 seconds with defaults).
VitalsReading collectAndAverageVitals();

// =============================================================================
// TODO — External Skin Temperature Sensor
// =============================================================================
// Currently returns 0.0f as a placeholder.
// Replace this implementation in vitals.cpp when you have wired in:
//   Option A: DS18B20 (one-wire, pin TEMP_PLACEHOLDER_PIN)
//             → Install "DallasTemperature" + "OneWire" libraries
//   Option B: MLX90614 (I2C, shared bus with MAX30102)
//             → Install "Adafruit MLX90614 Library"
// =============================================================================
float readSkinTemperature();

#endif // VITALS_H
