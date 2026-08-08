# 🦾 Robotic Hand Vitals Monitor & Control System

> **ESP32-driven 3D-printed robotic hand and biometric monitor.** Features automatic hand-placement detection, live vital signs sensing (Heart Rate, SpO₂, Skin Temperature with +4.2°C thermal offset calibration), direct USB WebSerial / Adafruit IO MQTT telemetry, and a multi-page Web Dashboard interface.

---

## 📷 Physical Hardware Model & Prototype

![Robotic Hand Physical Model](MODEL.jpeg)

*Figure 1: Assembled 3D-printed robotic hand with integrated MAX30102 biometric sensor mounted in the palm, tendon actuation assembly, and ESP32 control interface.*

---

## 🖼️ Web Application Dashboard Preview

### 🎛️ Overview Dashboard View
![Robotic Hand Vitals Monitor — Overview Dashboard](docs/images/dashboard_overview.png)

### 🫀 Biometric Vitals Telemetry View
![Robotic Hand Vitals Monitor — Vitals Telemetry Page](docs/images/dashboard_vitals.png)

The project includes a feature-rich web application (`/dashboard`) built with HTML5, CSS3, and JavaScript (Chart.js, WebSerial API):

- 🎛️ **Overview Page**: System status strip, real-time vitals cards, 3D hand render state sync, mini time-series chart, and live event log.
- 🫀 **Vitals Detail Page**: Dedicated biometric analytics with Min / Max / Avg stats and MAX30102 sensor architecture specs.
- 🦾 **Servo Kinematics Page**: Interactive 180° servo arc gauge dial, manual position slider, preset angle buttons (0° Open, 90° Mid, 180° Fold), and direct tendon movement controls.
- 📈 **History Analytics Page**: Interactive time-series trends with dataset toggles (HR, SpO₂, Temp), full telemetry record stream table, and **CSV Data Export**.
- 📋 **Session Audit Log Page**: Searchable event console with category filtering pills (All, FSM State, Vitals, Info, Errors) and **Log File Export**.

---

## ⚙️ Key System Features

- **Automatic Hand Detection & FSM Automation**: Uses MAX30102 IR photodiode value (> 50,000 counts) to trigger the finger-closing routine, biometric sampling, hold period, and automatic unfolding.
- **Biometric Calibration & Offsets**: Skin temperature reading calibrated with a +4.2°C thermal offset and continuous pulse oximetry averaging (HR in BPM, SpO₂ %).
- **Direct WebSerial (USB) & Adafruit IO Telemetry**: Full dual-mode connectivity — real-time serial JSON communication via Chrome/Edge WebSerial API (115200 baud) or wireless MQTT streaming to Adafruit IO feeds.
- **Interactive Manual Servo & Kinematics Control**: Send direct JSON commands (`fold`, `unfold`, `measure`, `servo angle`) over USB WebSerial to override or operate the robotic hand manually.
- **Safety Fail-Safe Protection**: Built-in 30-second failsafe timeout (`FAILSAFE_TIMEOUT_MS`) that automatically opens finger tendons if measurement stalls or fails.
- **Secure Credentials System**: Separated `config.example.h` template prevents committing Wi-Fi or Adafruit IO API keys to git repositories.

---

## 🔄 Finite State Machine (FSM) Flow

```
+--------+    IR > 50k    +--------+    Servo 180°    +---------+
|  IDLE  | -------------> |  FOLD  | --------------> | MEASURE |
+--------+                +--------+                  +---------+
    ^                                                      |
    |                                                 Vitals Valid
    |                 +----------+     Timer > 3s     +---------+
    +---------------- | COOLDOWN | <----------------- |  HOLD   |
         Timer > 3s   +----------+    Unfold 0°       +---------+
```

1. **IDLE**: Monitor MAX30102 IR sensor channel. Wait for hand/finger placement (IR value > 50,000).
2. **FOLD**: Drive SG90 / MG90S servo to 180° to flex finger tendons over sensor.
3. **MEASURE**: Collect IR/Red samples, compute Heart Rate (BPM), SpO₂ (%), and calibrated Skin Temp (°C).
4. **HOLD**: Display reading and transmit JSON telemetry (WebSerial & Adafruit IO MQTT).
5. **UNFOLD**: Move servo back to 0° to release finger tendons.
6. **COOLDOWN**: 3-second delay to clear sensor readings before returning to IDLE state.

---

## 🔌 Hardware Architecture & Pin Map

| Component | Part / Spec | Connection | Function |
|---|---|---|---|
| Microcontroller | ESP32 DevKit V1 (38-pin) | USB / External 5V | Core Controller & Wi-Fi / Serial Gateway |
| Biometric Sensor | MAX30102 Pulse Oximeter & Temp | I2C: SDA → **GPIO21**, SCL → **GPIO22** | Heart Rate, SpO₂, Skin Temperature & IR Hand Detection |
| Tendon Actuator | SG90 / MG90S Servo | Signal → **GPIO13** | PWM Finger Closing / Opening (0° – 180°) |

> ⚠️ **Power Notice**: Tendon servos must be powered by an external 5V power supply with a shared GND line to the ESP32. Do not attempt to drive servos directly from ESP32 development board power rails.

---

## 📂 Repository Structure

```
ROBOTICARM/
├── MODEL.jpeg                    # Photograph of final physical 3D-printed model
├── robotic_hand_render.png       # 3D digital render preview
├── BOM_initial.txt               # Hardware Bill of Materials & printing log
├── Project Description.docx      # Full technical specification & project report
├── 3D Files Robo Hand/           # STL 3D printing files for fingers, palm & base
├── Datasheets/                   # Technical datasheets (MAX30102, ESP32, MG90S)
├── docs/                         # Documentation assets & screenshots
│   └── images/
│       ├── dashboard_overview.png
│       └── dashboard_vitals.png
├── RoboticHandVitals/            # ESP32 C++ Arduino Firmware
│   ├── RoboticHandVitals.ino     # FSM & main loop
│   ├── config.example.h          # Configuration template (pins, Wi-Fi, offsets)
│   ├── vitals.h / vitals.cpp     # MAX30102 sensor driver & algorithms
│   ├── servo_control.h / cpp     # Servo PWM kinematics driver
│   ├── ir_sensor.h / cpp         # Hand placement detection logic
│   └── adafruit_io_helper.h / cpp# Wi-Fi & Adafruit IO MQTT client
└── dashboard/                    # Modern HTML5 / CSS3 / JS Web App
    ├── index.html                # Multi-tab single page interface
    ├── style.css                 # Dark Glassmorphism CSS design system
    ├── app.js                    # WebSerial manager, Chart.js telemetry & FSM sync
    └── assets/                   # Icons & 3D render assets
```

---

## 🛠️ Software Setup & Execution

### 1. ESP32 Firmware Setup (`RoboticHandVitals`)

1. Copy the example configuration template:
   ```bash
   cp RoboticHandVitals/config.example.h RoboticHandVitals/config.h
   ```
2. Edit `RoboticHandVitals/config.h` with your Wi-Fi & Adafruit IO credentials (or set `ENABLE_WIFI 0` for standalone offline mode):
   ```cpp
   #define ENABLE_WIFI   1
   #define WIFI_SSID     "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
   #define AIO_USERNAME  "YOUR_ADAFRUIT_IO_USERNAME"
   #define AIO_KEY       "YOUR_ADAFRUIT_IO_KEY"
   ```
3. Open `RoboticHandVitals/RoboticHandVitals.ino` in Arduino IDE.
4. Select **ESP32 Dev Module**, set baud rate to `115200`, and upload firmware.

### 2. Web Dashboard Launch (`/dashboard`)

You can launch the dashboard directly by opening `dashboard/index.html` in Chrome or Edge, or start a local development server:

```bash
python -m http.server 8000 --directory dashboard
```

Navigate to **[http://localhost:8000/](http://localhost:8000/)**, click **Connect USB Device**, select your ESP32 COM port, and experience real-time vitals monitoring & hand control!

---

## 📜 License

MIT License — free for academic, research, and personal use.

