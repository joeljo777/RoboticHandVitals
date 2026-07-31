// =============================================================================
// adafruit_io_helper.h — WiFi & Adafruit IO Publisher
// =============================================================================
#ifndef ADAFRUIT_IO_HELPER_H
#define ADAFRUIT_IO_HELPER_H

#include "vitals.h"

// Connect to WiFi network configured in config.h
bool connectWiFi();

// Initialise Adafruit IO connection
bool initAdafruitIO();

// Keep Adafruit IO connection alive / handle MQTT packets
void processAdafruitIO();

// Publish vital signs reading to Adafruit IO feeds
bool publishVitals(const VitalsReading& reading);

#endif // ADAFRUIT_IO_HELPER_H
