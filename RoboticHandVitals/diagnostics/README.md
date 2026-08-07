# Robotic Hand Vitals Monitor — Hardware Diagnostic Tools

This directory contains standalone diagnostic Arduino sketches designed to test, calibrate, and troubleshoot each hardware subsystem of the Robotic Hand Vitals Monitor independently.

---

## 📁 Diagnostic Sketches Overview

| Diagnostic Sketch | Subsystem Tested | Hardware Pins / Requirements |
| :--- | :--- | :--- |
| **`01_I2C_MAX30102_Diagnostic`** | I2C Bus, MAX30102 Photodiode, Die Temp | **SDA:** GPIO 21, **SCL:** GPIO 22, 3.3V, GND |
| **`02_Servo_Motor_Diagnostic`** | Servo Soft-Start Ramping & Calibration | **Signal:** GPIO 13, External 5V Power + Common GND |
| **`03_WiFi_AdafruitIO_Diagnostic`** | 2.4GHz Wi-Fi Scan, RSSI & Adafruit IO API | ESP32 Wi-Fi antenna, `config.h` credentials |
| **`04_Interactive_System_Diagnostic`** | All Subsystems (Menu Driven Serial Suite) | Complete setup with Serial commands |

---

## 🚀 How to Use

1. Open any of the `.ino` files in **Arduino IDE** (or VS Code with Arduino extension).
2. Select your board: **ESP32 Dev Module** (or `DOIT ESP32 DEVKIT V1`).
3. Set Serial Monitor Baud Rate to **`115200`**.
4. Upload the sketch to test the target component.

---

## 🔧 Subsystem Details

### 1️⃣ I2C & MAX30102 Diagnostic (`01_I2C_MAX30102_Diagnostic.ino`)
- Scans I2C bus addresses `0x01` to `0x7F` (verifies MAX30102 at address **`0x57`**).
- Prints raw Red & IR optical reflections.
- Flags finger detection when IR reading exceeds `50,000`.
- Outputs raw die temperature with offset calibration.

### 2️⃣ Servo Motor Calibration (`02_Servo_Motor_Diagnostic.ino`)
- Sweeps from `0°` (Open) to `180°` (Closed) using smooth soft-start ramping.
- Accept manual target angles via Serial Monitor input (e.g., type `0`, `90`, `180`, or `sweep`).

### 3️⃣ Wi-Fi & Adafruit IO Test (`03_WiFi_AdafruitIO_Diagnostic.ino`)
- Scans all 2.4GHz Wi-Fi networks in range and reports RSSI (signal strength in dBm).
- Verifies Wi-Fi connection and local IP allocation.
- Tests HTTP POST calls to Adafruit IO for `heart_rate`, `spo2`, and `temperature`.

### 4️⃣ Comprehensive Menu Suite (`04_Interactive_System_Diagnostic.ino`)
Interactive serial menu:
- `1`: Test I2C & MAX30102 Sensor
- `2`: Test Servo Sweep
- `3`: Test Wi-Fi & Adafruit IO Cloud
- `4`: Stream Live Optical Readings (Type `s` to exit)
- `5`: Run Full Single-Cycle Integration Test
