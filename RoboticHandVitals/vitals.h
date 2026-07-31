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
  float temperature;  // Temperature °C (read from MAX30102 onboard die sensor)
  bool  valid;        // false if sensor returned garbage/timeout
};

// Initialise I2C and the MAX30102 sensor
bool initVitals();

// Collect MEASURE_SAMPLES readings spaced MEASURE_INTERVAL_MS apart,
// then return the averaged result. Blocking call (~6 seconds with defaults).
VitalsReading collectAndAverageVitals();

// Reads temperature directly from MAX30102 onboard die temperature sensor (°C)
float readSkinTemperature();

#endif // VITALS_H
