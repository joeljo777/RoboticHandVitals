// =============================================================================
// adafruit_io_helper.cpp — WiFi & Adafruit IO Publisher
// =============================================================================
#include "adafruit_io_helper.h"
#include "config.h"

#if ENABLE_WIFI
#include <WiFi.h>
#include <Adafruit_MQTT.h>
#include <Adafruit_MQTT_Client.h>

#define AIO_SERVER      "io.adafruit.com"
#define AIO_SERVERPORT  1883 // MQTT port

static WiFiClient client;
static Adafruit_MQTT_Client mqtt(&client, AIO_SERVER, AIO_SERVERPORT, AIO_USERNAME, AIO_KEY);

static Adafruit_MQTT_Publish feedHR   = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/heart-rate");
static Adafruit_MQTT_Publish feedSpO2 = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/spo2");
static Adafruit_MQTT_Publish feedTemp = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/temperature");
#endif

bool connectWiFi() {
#if ENABLE_WIFI
  if (WiFi.status() == WL_CONNECTED) return true;

  DBGF("[WIFI] Connecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 15000) {
    delay(500);
    DBG(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    DBGLN("\n[WIFI] Connected! IP: " + WiFi.localIP().toString());
    return true;
  } else {
    DBGLN("\n[WIFI] Connection failed!");
    return false;
  }
#else
  DBGLN("[WIFI] Wi-Fi feature is currently disabled (Offline Mode).");
  return false;
#endif
}

bool initAdafruitIO() {
#if ENABLE_WIFI
  if (strcmp(AIO_USERNAME, "YOUR_ADAFRUIT_IO_USERNAME") == 0 || strcmp(AIO_KEY, "YOUR_ADAFRUIT_IO_KEY") == 0) {
    DBGLN("[AIO] Notice: Adafruit IO credentials not set in config.h. Skipping cloud publish.");
    return false;
  }

  if (!connectWiFi()) return false;

  if (mqtt.connected()) return true;

  DBGLN("[AIO] Connecting to Adafruit IO MQTT...");
  int8_t ret;
  uint8_t retries = 3;
  while ((ret = mqtt.connect()) != 0 && retries > 0) {
    DBGLN(mqtt.connectErrorString(ret));
    DBGLN("[AIO] Retrying MQTT connection in 2 seconds...");
    mqtt.disconnect();
    delay(2000);
    retries--;
  }

  if (mqtt.connected()) {
    DBGLN("[AIO] Adafruit IO MQTT Connected!");
    return true;
  } else {
    DBGLN("[AIO] Failed to connect to Adafruit IO MQTT.");
    return false;
  }
#else
  return false;
#endif
}

void processAdafruitIO() {
#if ENABLE_WIFI
  if (mqtt.connected()) {
    mqtt.ping();
  }
#endif
}

bool publishVitals(const VitalsReading& reading) {
  if (!reading.valid) {
    DBGLN("[AIO] Skipping publish: Reading invalid");
    return false;
  }

#if ENABLE_WIFI
  if (!initAdafruitIO()) {
    DBGLN("[AIO] Skipping publish: Network connection unavailable");
    return false;
  }

  DBGF("[AIO] Publishing HR: %.1f, SpO2: %.1f, Temp: %.1f\n", reading.heartRate, reading.spO2, reading.temperature);

  bool ok = true;
  if (!feedHR.publish(reading.heartRate)) ok = false;
  delay(500);
  if (!feedSpO2.publish(reading.spO2)) ok = false;
  delay(500);
  if (!feedTemp.publish(reading.temperature)) ok = false;

  if (ok) {
    DBGLN("[AIO] All vital signs published successfully!");
  } else {
    DBGLN("[AIO] Error: One or more feeds failed to publish.");
  }
  return ok;
#else
  DBGF("[VITALS REPORT (OFFLINE)] HR: %.1f BPM | SpO2: %.1f%% | Temp: %.1f °C\n",
       reading.heartRate, reading.spO2, reading.temperature);
  return true;
#endif
}
