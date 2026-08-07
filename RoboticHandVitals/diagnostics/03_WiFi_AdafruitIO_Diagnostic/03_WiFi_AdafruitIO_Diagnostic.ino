// =============================================================================
// 03_WiFi_AdafruitIO_Diagnostic.ino
// Robotic Hand Vitals Monitor — Wi-Fi & Adafruit IO Connection Test Tool
// =============================================================================
// Description:
//   1. Scans nearby 2.4 GHz Wi-Fi networks and reports RSSI signal strength.
//   2. Attempts connection using credentials in config.h.
//   3. Tests Adafruit IO HTTP API connection by pushing test vitals feeds.
// =============================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include "../../config.h"

void scanWiFiNetworks() {
  Serial.println("\n-------------------------------------------");
  Serial.println("[WIFI DIAG] Scanning 2.4GHz Wi-Fi networks...");
  int n = WiFi.scanNetworks();
  if (n == 0) {
    Serial.println("[WIFI DIAG] No networks found.");
  } else {
    Serial.printf("[WIFI DIAG] %d networks found:\n", n);
    for (int i = 0; i < n; ++i) {
      Serial.printf("  %2d: %-32s (%d dBm) %s\n",
                    i + 1,
                    WiFi.SSID(i).c_str(),
                    WiFi.RSSI(i),
                    (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "[Open]" : "[Secured]");
    }
  }
  Serial.println("-------------------------------------------\n");
}

bool sendTestAdafruitIOFeed(String feedName, float value) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[AIO DIAG] Cannot send data: Wi-Fi not connected!");
    return false;
  }

  HTTPClient http;
  String url = "https://io.adafruit.com/api/v2/" + String(AIO_USERNAME) + "/feeds/" + feedName + "/data";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-AIO-Key", AIO_KEY);

  String payload = "{\"value\":" + String(value, 2) + "}";
  Serial.printf("[AIO DIAG] Publishing to %s -> %s ... ", feedName.c_str(), payload.c_str());

  int httpCode = http.POST(payload);
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✅ SUCCESS (HTTP 200/201)");
    http.end();
    return true;
  } else {
    Serial.printf("❌ FAILED (HTTP %d)\n", httpCode);
    String response = http.getString();
    Serial.printf("[AIO DIAG] Response: %s\n", response.c_str());
    http.end();
    return false;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n==================================================");
  Serial.println("   WI-FI & ADAFRUIT IO DIAGNOSTIC TOOL STARTED    ");
  Serial.println("==================================================");

  // Scan WiFi
  scanWiFiNetworks();

  // Connect WiFi
  Serial.printf("[WIFI DIAG] Connecting to SSID: '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI DIAG] ✅ Wi-Fi Connected!");
    Serial.printf("[WIFI DIAG] IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI DIAG] Signal Strength (RSSI): %d dBm\n", WiFi.RSSI());

    Serial.println("\n[AIO DIAG] Testing Adafruit IO Connection & Feeds...");
    sendTestAdafruitIOFeed("heart_rate", 75.0);
    sendTestAdafruitIOFeed("spo2", 98.0);
    sendTestAdafruitIOFeed("temperature", 36.6);
  } else {
    Serial.println("\n[WIFI DIAG] ❌ Failed to connect to Wi-Fi. Check SSID/Password or ensure 2.4GHz network.");
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[STATUS] Wi-Fi Active | RSSI: %d dBm | IP: %s\n", WiFi.RSSI(), WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[STATUS] ❌ Disconnected from Wi-Fi!");
  }
  delay(5000);
}
