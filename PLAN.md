# Nomad: V1 Engineering & Implementation Plan
**Offline, Serverless, Off-Grid Ride-Hailing Protocol & Prototype**

---

## 1. Context & Core Objectives

Nomad is a tactical proof-of-concept designed to prove that serverless, peer-to-peer ride hailing is viable without cellular, Wi-Fi, or internet infrastructure. By routing data through ultra-cheap hardware-bridged transceivers and running high-performance vector map rendering locally on off-the-shelf smartphones, Nomad establishes a resilient transit alternative for disaster zones, network blackouts, or off-grid remote areas.

### V1 Strategic Goals
Rather than building a complex multi-hop routing mesh first, the V1 prototype is hyper-focused on proving two critical, high-risk operational hypotheses:

1. **RF Viability:** Can low-power 2.4GHz ESP-NOW raw broadcasting achieve reliable bidirectional communication at target urban ranges (>50 meters) without gateway infrastructure?
2. **Offline GIS Performance:** Can typical consumer Android devices render fluid, detailed vector map data locally with zero external network asset calls?

---

## 2. Communication Topology

Nomad bypasses the overhead of Bluetooth Mesh and cellular routing. Instead, it pairs each mobile device with a dedicated hardware "pocket node" over BLE, using raw ESP-NOW broadcasts as the long-range transit medium.

```
  [ Rider Phone ]             [ Rider ESP32 ]               [ Driver ESP32 ]             [ Driver Phone ]
  ┌─────────────┐             ┌─────────────┐               ┌─────────────┐              ┌──────────────┐
  │  Nomad App  │             │ Pocket Node │               │  Dash Node  │              │  Nomad App   │
  │ (Offline Map│             │ (Transceiver│               │ (Transceiver│              │ (Offline Map │
  └──────┬──────┘             └──────┬──────┘               └──────┬──────┘              └──────┬───────┘
         │                           │                             │                            │
         │─── 1. BLE Serial (NUS) ──▶│                             │                            │
         │    "REQ,R1,Lat,Lon"       │                             │                            │
         │    (MTU: 128 Bytes)       │                             │                            │
         │                           │──── 2. ESP-NOW Broadcast ──▶│                            │
         │                           │      (FF:FF:FF:FF:FF:FF)    │                            │
         │                           │      (Radio packet)         │                            │
         │                           │                             │─── 3. BLE Serial (NUS) ───▶│
         │                           │                             │    "REQ,R1,Lat,Lon"        │
         │                           │                             │    (MTU: 128 Bytes)        │
```

---

## 3. The MVP Definition: The Smallest Testable Loop

The V1 MVP is defined as the absolute minimum surface area required to execute an end-to-end, off-grid transaction between two actors:

* **Hardware State:** Two standard Android smartphones, two ESP32-C3 developer boards.
* **Network Isolation:** Both phones are placed in strict **Airplane Mode** (Cellular, Wi-Fi, and Mobile Data disabled; Bluetooth and GPS manually re-enabled).
* **The Loop:**
  1. **Locate & Request:** The Rider drops a coordinate pin on the offline map, hits "Request", and the phone writes a lightweight request string over BLE UART.
  2. **Air-Gap Relay:** The Rider's ESP32 encapsulates the request string and broadcasts it via ESP-NOW.
  3. **Capture & Render:** The Driver's ESP32 intercepts the ESP-NOW broadcast and pushes it up to the Driver's phone via BLE UART notification. The Driver's app alerts the driver, renders the Rider's pin, and draws a straight vector line between their current coordinates.
  4. **Accept & Bind:** The Driver hits "Accept". The acceptance frame travels back across the ESP-NOW bridge to the Rider's phone, rendering the Driver's pin and confirming the match.

---

## 4. Minimal Wire Protocol

To maximize channel capacity, minimize processing overhead on resource-constrained microcontrollers, and keep parsing dead-simple, the system transmits lightweight, comma-separated values (CSV) over the air.

### REQ Frame (Rider Request)
* **Description:** Broadcast from Rider to alert any nearby driver nodes of an active hailing request.
* **Format:** `REQ,<rider_id>,<lat>,<lon>`
* **Payload Size:** ~25–30 Bytes

```csv
REQ,R1,40.7128,-74.0060
```

### ACC Frame (Driver Acceptance)
* **Description:** Broadcast from Driver targeting a specific Rider ID to lock the transaction.
* **Format:** `ACC,<rider_id>,<driver_id>,<driver_lat>,<driver_lon>`
* **Payload Size:** ~35–45 Bytes

```csv
ACC,R1,D9,40.7142,-74.0075
```

---

## 5. Technology Stack & Development Environment

Nomad is intentionally built on a stack that a solo developer can own end-to-end using widely-known languages (JavaScript/React, Python, Java, HTML/CSS). Only a single, small, write-once C++ firmware file sits outside that skillset.

| Layer | Technology | Language | Developer Ownership |
| :--- | :--- | :--- | :--- |
| **Mobile App** | React Native (Expo SDK 57) | JavaScript / JSX | Fully owned — React with mobile primitives; CSS-like `StyleSheet` |
| **Map Rendering** | `@maplibre/maplibre-react-native` | JavaScript | Fully owned — local `mbtiles:///` vector rendering |
| **BLE Transport** | `react-native-ble-plx` | JavaScript | Fully owned — scan, connect, NUS, MTU negotiation |
| **Map Data Tooling** | Python scripts + Planetiler CLI | Python / Java (CLI only) | Fully owned — no Java code, Planetiler run as a command |
| **Firmware** | PlatformIO + Arduino framework (ESP32-C3) | C++ (~200 lines) | **Black box** — written once, flashed, rarely touched |
| **Build & Tooling** | Expo CLI, PlatformIO CLI, Planetiler | — | Command-line usage only |

### Firmware as a Black Box
The ESP32-C3 bridge firmware is deliberately scoped to a single, stable C++ file (~200 lines). It is written and handed over fully built and heavily commented. Using it requires no C++ knowledge — only flashing via `pio run -t upload`. All ongoing iteration (application code, UI, map styles, wire protocol, ride flow) happens in JavaScript and Python.

---

## 6. Milestone-Based Build Order

```
┌─────────────────────────────────┐
│  Milestone 1: Offline Map Shell │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Milestone 2: Radio Bridge Firm. │ ── [Coexistence Mitigation Pathway]
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Milestone 3: BLE Integration    │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Milestone 4: Request/Accept Flow│
└─────────────────────────────────┘
```

### Milestone 1: Offline Map Shell
* **Objective:** Establish fluid vector map rendering on Android with zero external dependencies.
* **Technology Stack:** Expo (custom Dev Client), `@maplibre/maplibre-react-native`.
* **Pipeline:**
  1. **Asset Generation:** Use **Planetiler** to slice a compact OpenStreetMap `.osm.pbf` file of the target testing city into a localized `<15MB` vector tile bundle (`city.mbtiles`).
  2. **Bundling:** Embed the `city.mbtiles` directly inside the Android application assets.
  3. **Style Engineering:** Author a localized `style.json` configured to read from the local database scheme (`mbtiles://{path_to_mbtiles}`) instead of standard online CDNs (Mapbox, Maptiler).
  4. **Interactivity:** Map interface must allow dragging/tapping to drop coordinates pins (representing hailing source/destination) and fetch their latitude and longitude programmatically.
* **Exit Test:** Launch the app in **Airplane Mode** on a fresh install. The map must render, pan, and zoom smoothly, allowing pinning without showing network errors or missing tiles.

### Milestone 2: Radio Bridge Firmware
* **Objective:** Code the ESP32-C3 transceivers to bridge Bluetooth LE UART directly to long-range raw ESP-NOW broadcast frames.
* **Platform:** VS Code + PlatformIO.
* **Libraries:** `NimBLE-Arduino` (lightweight BLE stack), standard ESP-NOW Arduino headers.
* **Hardware Architecture:** The ESP32-C3 uses a single-core RISC-V processor with a single shared 2.4GHz physical radio antenna. Coexistence is the primary failure vector.

#### ⚠️ ESP32-C3 RF Coexistence (Coex) Risk Mitigation Pathway
Because BLE and ESP-NOW (running over the Wi-Fi physical layer) share a single antenna, an active BLE connection can starve or completely block ESP-NOW RX scanning, resulting in silent packet drops.

```
     BLE Activity Window          ESP-NOW RX Scanning
  ┌───────────────────────┐    ┌───────────────────────┐
  │   Active Connection   │───▶│   Antenna Handover    │  (Must occur frequently
  │   Interval (100ms+)   │    │   to prevent RX loss) │   to capture bursts)
  └───────────────────────┘    └───────────────────────┘
```

1. **Initial Mitigation (Arduino Level):**
   * Configure **long BLE connection intervals** (`100ms` to `200ms`) and high latency in the NimBLE stack. This ensures the BLE transceiver wakes up briefly to maintain connection, leaving wide, predictable windows of idle radio time for ESP-NOW packet listening.
   * Allocate dedicated, non-overlapping transmit buffers to prevent hardware thread contention.
2. **Deep Mitigation (Native ESP-IDF 5.5.1 Fallback):**
   * If testing reveals packet drop rates exceeding 15% due to BLE activity, bypass Arduino wrappers and compile using native **ESP-IDF v5.5.1**.
   * Enable the RF Coexistence Arbiter in `sdkconfig` via:
     ```sdkconfig
     CONFIG_ESP_COEX_ENABLE=y
     ```
   * Set RF priority to favor Wi-Fi/ESP-NOW:
     ```c
     esp_coex_preference_set(ESP_COEX_PREFER_WIFI);
     ```
   * Anchor ESP-NOW to a fixed Wi-Fi channel (Channel 1, 6, or 11) to avoid channel-hopping overhead, and restrict BLE advertising/scanning parameters to align with the same radio scheduling slots.

* **Exit Test:**
  * **Bench Test:** Power two nodes via USB. Send a string into Node A's serial console; Node B must receive it over the air and print it immediately to its USB Serial interface (`Serial.println`).
  * **Outdoor Range Test:** Position Node A and Node B 100 meters apart in a semi-urban environment (open street/park) with standard 2.4GHz noise. Transmit 100 test packets; success requires a delivery rate of $\ge 90\%$.

### Milestone 3: Phone-to-Board BLE Integration
* **Objective:** Establish bidirectional, zero-loss communication between the Android React Native app and the ESP32-C3.
* **Technology Stack:** `react-native-ble-plx` in Expo.
* **GATT Contract (Nordic UART Service - NUS):**
  * **Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
  * **TX Characteristic (Write without Response):** `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` (Phone to ESP32)
  * **RX Characteristic (Notify):** `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (ESP32 to Phone)
* **MTU Engineering:** Negotiate BLE MTU (Maximum Transmission Unit) to **128 Bytes** on connection. This easily encompasses our entire CSV wire frame (max ~45 bytes) inside a single unfragmented L2CAP packet, preventing packet fragmentation, high latency, and processing overhead.
* **Exit Test (Round-Trip Proofing):** Send `"TEST"` from Rider Phone BLE -> Rider ESP32 -> ESP-NOW broadcast -> Driver ESP32 -> Driver Phone BLE notification. String must print on Driver app UI instantly (<250ms).

### Milestone 4: Full Request/Accept Flow
* **Objective:** Implement application-layer logic to parse CSV packets, manage transaction state, and update the Map UI in real time.
* **Features:**
  1. **CSV Parser:** On-the-fly string parser in React Native.
  2. **State Management:** Simple memory-only hook state to handle: `IDLE` ➔ `REQUEST_SENT` ➔ `MATCHED`.
  3. **Vector Rendering:** Upon REQ packet capture on the Driver Phone, read coordinates, render Rider Pin on map, and draw a straight vector line connecting Driver's coordinate (or mock GPS) with the Rider's coordinate. Repeat on the Rider Phone upon receiving the ACC packet.
* **Exit Test:** Execute the entire field test protocol (see Section 9) over a distance of $\ge 50$ meters.

---

## 7. Hardware Configuration & BOM

| Component | Qty | Specification | Role | V1 Engineering Notes |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32-C3 Dev Board** | 2 | Single-Core RISC-V SoC (e.g., NodeMCU or Seeed Xiao C3) | Long-range RF transceivers | Models with an **IPEX external antenna connector** and an external stub antenna are required for range viability. Avoid PCBs with internal-only trace antennas. |
| **Android Smartphone** | 2 | Android OS 8.0+, Bluetooth 5.0+, Integrated GPS | Host Application & Map UI | standard off-the-shelf devices; high-brightness display recommended for field testing. |
| **USB-C Cables & Power** | 2 | Shielded USB-C OTG cables / external power banks | Power Delivery & Debugging | Used to power the ESP32-C3 nodes on-the-go from the phone's battery via OTG, or from portable power banks. |

---

## 8. Scope Safeguards (Explicit V1 Cuts)

To maintain extreme focus and ensure a reliable, rapid delivery, the following features are **explicitly cut** from the V1 scope:

* 🛑 **Multi-Hop / Mesh Routing:** No ad-hoc mesh routing protocols (Reticulum, ESP-Mesh, or AODV) are supported. Transmissions are strictly single-hop direct broadcasts.
* 🛑 **Crypto-Security & Handshakes:** No encryption, anti-spoofing, or token handshakes. CSV payloads are sent as clear-text. V1 assumes a trusted testing environment.
* 🛑 **iOS Native Support:** Cut entirely due to iOS background Bluetooth connection constraints and deployment friction. V1 is Android-only.
* 🛑 **Dynamic Route Calculation:** No offline street-routing engines (e.g., OSRM, Valhalla). Pin connections are rendered as direct, point-to-point geometric vector lines (Haversine calculations).
* 🛑 **Persistent Storage:** No localized databases (SQLite/WatermelonDB) to save ride history on-device. Application state is volatile and cleared on restart.
* 🛑 **Live Tracking Stream:** No real-time continuous coordinate streaming. The system only broadcasts single-event static pins (`REQ` and `ACC`).

---

## 9. Validation Protocol & Pass/Fail Criteria

### Field Test Procedure
1. Perform clean installs of the Nomad app on both Android devices.
2. Put both phones in **Airplane Mode** (Cellular, Wi-Fi, and Data OFF). Manually enable **Bluetooth** and **GPS/Location**.
3. Connect the ESP32-C3 nodes to portable power. Confirm BLE auto-connects to the respective phones.
4. Separate the Rider and Driver by **50 meters** in an open-air public environment.
5. **Rider Action:** Drag map, drop destination pin, and press "Request Ride".
6. **Driver Observation:** Within <5 seconds, verify the Driver Phone displays the Rider's pin and a connecting vector line.
7. **Driver Action:** Press "Accept".
8. **Rider Observation:** Within <5 seconds, verify the Rider Phone displays the Driver's pin and confirms the matched state.

### Explicit Pass/Fail Matrix

| Dimension | Target Metric (PASS) | Failure Condition (FAIL) |
| :--- | :--- | :--- |
| **Data Independence** | Map tiles and coordinates load instantly under full network isolation. | Blanks maps, indefinite spinner, or app crashing due to lack of network. |
| **RF Coexistence** | ESP32-C3 maintains an active BLE link while receiving/transmitting ESP-NOW. | ESP32-C3 crashes, drops the BLE connection, or freezes during ESP-NOW activity. |
| **Physical Range** | Full transaction loop completes successfully at a separation of **$\ge 50$ meters**. | Packets drop consistently or fail to register at 50 meters. |
| **System Latency** | Transaction state updates and map-line renders occur within **$< 5$ seconds**. | System takes >5 seconds, stalls, or requires manual device restarts. |
