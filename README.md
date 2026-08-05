# 🦾 Robotic Hand Vitals Monitor & Control System

> **ESP32-driven 3D-printed robotic hand and biometric monitor.** Features hand-placement detection, live vital signs sensing (Heart Rate, SpO₂, Temperature with +4.2°C thermal offset calibration), direct USB WebSerial / Adafruit IO MQTT telemetry, and a multi-page Web Dashboard interface.

---

## 🖼️ Web Application Dashboard Preview

### 🎛️ Overview Dashboard View
![Robotic Hand Vitals Monitor — Overview Dashboard](docs/images/dashboard_overview.png)

### 🫀 Biometric Vitals Telemetry View
![Robotic Hand Vitals Monitor — Vitals Telemetry Page](docs/images/dashboard_vitals.png)

The project includes a multi-page web application (`/dashboard`) built with HTML5, CSS3, and JavaScript (Chart.js):

- 🎛️ **Overview Page**: System status strip, real-time vitals cards, 3D hand render state sync, mini time-series chart, and live event log.
- 🫀 **Vitals Detail Page**: Dedicated biometric analytics with Min / Max / Avg stats and MAX30102 sensor architecture specs.
- 🦾 **Servo Kinematics Page**: Interactive 180° servo arc gauge dial, manual position slider, preset angle buttons (0° Open, 90° Mid, 180° Fold), and direct tendon movement controls.
- 📈 **History Analytics Page**: Interactive time-series trends with dataset toggles (HR, SpO₂, Temp), full telemetry record stream table, and **CSV Data Export**.
- 📋 **Session Audit Log Page**: Searchable event console with category filtering pills (All, FSM State, Vitals, Info, Errors) and **Log File Export**.

---

## ⚙️ Key System Features

- **Direct WebSerial (USB) & MQTT Telemetry**: Connect directly via Chrome/Edge WebSerial at 115200 baud over USB or stream wirelessly via Adafruit IO MQTT & REST API.
- **Biometric Calibration**: Calibrated skin temperature offset (+4.2°C) and live sample streaming during finger-folding calculation stages.
- **Fail-Safe Mechanism**: Automatic finger release if measurement exceeds `FAILSAFE_TIMEOUT_MS` (30s) or upon Wi-Fi / sensor error.
- **Secure Credentials System**: `config.example.h` template prevents accidental git commits of Wi-Fi or API secret keys.

---

## 🔄 Finite State Machine (FSM) Flow

```
IDLE → Hand Detected (MAX30102 IR > 50k) 
     → FOLD (Servo closes fingers to 180°)
     → MEASURE (Calculates HR, SpO2 & Temp +4.2°C)
     → HOLD (Displays vitals & publishes telemetry)
     → UNFOLD (Servo opens fingers to 0°)
     → COOLDOWN → IDLE
```

---

## 🔌 Hardware Architecture & Pin Map

| Component | Part / Spec | Connection | Function |
|---|---|---|---|
| Microcontroller | ESP32 DevKit V1 (38-pin) | — | Core Controller |
| Biometric Sensor | MAX30102 Module | I2C: SDA → **GPIO21**, SCL → **GPIO22** | Heart Rate, SpO₂, Skin Temperature & IR Hand Placement Detection |
| Tendon Actuator | SG90 / MG90S Servo | Signal → **GPIO13** | PWM Finger Closing / Opening (0° – 180°) |

> ⚠️ **Power Requirement**: Servo motor must be powered by an external 5V power supply (common GND with ESP32). Do not power the servo directly from the ESP32 3.3V/5V onboard pins.

---

## 🛠️ Software Setup & Credentials

### 1. Firmware Configuration (`RoboticHandVitals`)

1. Copy `config.example.h` to `config.h`:
   ```bash
   cp RoboticHandVitals/config.example.h RoboticHandVitals/config.h
   ```
2. Edit `RoboticHandVitals/config.h` with your Wi-Fi and Adafruit IO credentials:
   ```cpp
   #define WIFI_SSID     "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
   #define AIO_USERNAME  "YOUR_ADAFRUIT_IO_USERNAME"
   #define AIO_KEY       "YOUR_ADAFRUIT_IO_KEY"
   ```
   *(Note: `config.h` is ignored by `.gitignore` so your private credentials will never be committed to GitHub).*

3. Open `RoboticHandVitals/RoboticHandVitals.ino` in Arduino IDE, select **ESP32 Dev Module**, and upload at 115200 baud.

### 2. Web Dashboard Launch (`/dashboard`)

Simply open `dashboard/index.html` directly in your browser or run a local HTTP server:

```bash
python -m http.server 8000 --directory dashboard
```

Open **[http://localhost:8000/](http://localhost:8000/)** in Chrome or Edge.

---

## 📜 License

MIT License — free for academic, research, and personal use.
