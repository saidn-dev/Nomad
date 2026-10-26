# Nomad

**Ride hailing without cellular, Wi-Fi, or internet.** Each phone pairs over BLE with a pocket-sized ESP32-C3 radio, and the radios carry ride requests between each other over ESP-NOW. Phones render the map from tiles stored on the device. No server or network sits in the middle.

![Expo SDK 57](https://img.shields.io/badge/Expo_SDK-57-000020?logo=expo)
![Platform: Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white)
![Status: prototype](https://img.shields.io/badge/status-prototype-orange)

It is a proof of concept for disaster zones, network blackouts, and off-grid areas. The test map covers **Uganda, with Kampala in street-level detail**.

```
Rider phone ──BLE──▶ Rider ESP32 ──ESP-NOW broadcast──▶ Driver ESP32 ──BLE──▶ Driver phone
 (Nomad app)          (pocket node)                      (dash node)           (Nomad app)
```

> [!NOTE]
> Nomad is an early prototype. The offline map works today. The radio link is still at the hardware-validation stage, so the **Request** and **Accept** buttons do nothing yet.

---

## What V1 tests

V1 exists to answer two questions before anything more ambitious gets built:

| Hypothesis | Pass criterion |
| :--- | :--- |
| **RF viability**: raw ESP-NOW broadcasts work at street range with no gateway | A full request/accept loop at ≥ 50 m, in under 5 s |
| **Offline GIS**: ordinary Android phones render detailed vector maps with no network | Map renders, pans, and zooms in Airplane Mode on a fresh install |

## Status

| Milestone | State |
| :--- | :--- |
| **1. Offline map shell** | Implemented: dark offline map, tap to drop a pin, camera kept inside Uganda |
| **2. Radio bridge firmware** | In progress: two bench-test firmware projects written, hardware results not yet recorded |
| **3. Phone-to-board BLE** | Planned |
| **4. Request/accept flow** | Planned |

<!-- TODO: update Milestone 2 once the firmware is compile-verified and bench results are in test-logs/results-template.csv -->

---

## Repository layout

| Path | Contents |
| :--- | :--- |
| [`app/`](app/README.md) | Expo / React Native app. One shared `App.js` runs on Android and in the browser |
| [`firmware/`](firmware/README.md) | PlatformIO test firmware for ESP32-C3: `espnow_two_way/` (board ↔ board) and `ble_nus/` (phone ↔ board) |
| [`tools/browser-map/`](tools/browser-map/README.md) | Dependency-free Node server for viewing `city.mbtiles` in a desktop browser |
| [`test-logs/`](test-logs/results-template.csv) | Results template for the Milestone 2 bench tests |
| [`PLAN.md`](PLAN.md) | V1 engineering plan: topology, protocol, milestones, BOM, field-test protocol |
| [`MILESTONE-2.md`](MILESTONE-2.md), [`MILESTONE-2-PREP.md`](MILESTONE-2-PREP.md) | Hardware validation plan and the bench-test runbook |

## Prerequisites

| For | You need |
| :--- | :--- |
| App and browser preview | Node.js and npm <!-- TODO: state the minimum Node.js version for app/ (package.json has no "engines" field) --> |
| Browser map viewer | Node.js **22+** (uses the built-in `node:sqlite`) |
| Device builds | An Android phone or emulator, plus the Android toolchain that `npx expo run:android` uses |
| Firmware | Python 3.11–3.13 and PlatformIO; two ESP32-C3 boards (the bench setup uses the SuperMini) and USB **data** cables |

## Getting started

### 1. Get the map data

The offline tile archive is **not committed**. `*.mbtiles`, `*.pmtiles`, and `*.osm.pbf` are gitignored. The app expects `app/assets/city.mbtiles`, one OpenMapTiles-schema archive built with Planetiler from two OpenStreetMap extracts:

| Zooms | Coverage | Source extract |
| :--- | :--- | :--- |
| z0–10 | All of Uganda | Uganda `.osm.pbf` |
| z11–15 | Kampala only | Kampala `.osm.pbf` |

<!-- TODO: add the exact extract sources and the Planetiler commands that build and merge city.mbtiles; no build script exists in the repo yet -->

### 2. Run the app

```bash
git clone https://github.com/saidn-dev/Nomad.git
cd Nomad/app
npm install
```

`npm install` also syncs MapLibre's web worker and the bundled label fonts into `public/`.

**Browser preview** (the fastest way to iterate on the UI):

```bash
npm run web
```

Open <http://localhost:8081>. Once the page has loaded, the preview makes no network requests at all. Before the first web run, convert the tiles to PMTiles, which browsers can read with HTTP range requests. The converter is `pmtiles` from [go-pmtiles releases](https://github.com/protomaps/go-pmtiles/releases).

```bash
pmtiles convert assets/city.mbtiles public/city.pmtiles
```

**Android device** (development build):

```bash
npx expo run:android
```

Release builds, static-site deployment (Netlify, GitHub Pages), camera limits, and the offline glyph pipeline are covered in [`app/README.md`](app/README.md).

<!-- TODO: link the hosted web demo here once it is deployed -->

### 3. Flash the test firmware

```bash
python -m pip install --upgrade platformio
cd firmware/espnow_two_way
pio run -t upload
pio device monitor
```

The monitor runs at 115200 baud. Flash the same `espnow_two_way` sketch onto **both** boards, then type `send 1000 50` on one of them to run a delivery test. Serial commands, expected output, and fixes for common USB problems are in [`firmware/README.md`](firmware/README.md).

### Optional: inspect the map on a desktop

```bash
node tools/browser-map/server.mjs
```

Run this from the repository root. It serves `app/assets/city.mbtiles` at <http://127.0.0.1:8123/> with labels and a dark-mode toggle, and needs no `npm install`. On Windows you can double-click `tools/browser-map/open-map.cmd` instead.

---

## Wire protocol

Frames are plain comma-separated text, small enough to fit in one BLE packet (the plan negotiates a 128-byte MTU).

| Frame | Direction | Format | Example |
| :--- | :--- | :--- | :--- |
| `REQ` | Rider → any driver | `REQ,<rider_id>,<lat>,<lon>` | `REQ,R1,40.7128,-74.0060` |
| `ACC` | Driver → that rider | `ACC,<rider_id>,<driver_id>,<driver_lat>,<driver_lon>` | `ACC,R1,D9,40.7142,-74.0075` |

Phones talk to their boards over the Nordic UART Service (NUS):

| Role | UUID |
| :--- | :--- |
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX: phone → board (write without response) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX: board → phone (notify) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

> [!WARNING]
> **The main technical risk is RF coexistence.** On the ESP32-C3, BLE and ESP-NOW share a single 2.4 GHz radio, and an active BLE connection can starve ESP-NOW reception. Milestone 2 tests for this before anything else gets built on top. The mitigations are in [`PLAN.md`](PLAN.md) §6 and [`MILESTONE-2-PREP.md`](MILESTONE-2-PREP.md) §5.

## Out of scope for V1

- **No mesh routing.** Every transmission is a single-hop broadcast.
- **No encryption or authentication.** Frames are sent as clear text, and V1 assumes a trusted test environment.
- **Android only.** iOS was cut because of its background-Bluetooth limits.
- **No street routing.** Rider and driver pins are joined by a straight line.
- **No persistence or live tracking.** State is lost on restart, and only single `REQ`/`ACC` events are sent.

## Contributing

Nomad is a solo prototype. Issues and suggestions are welcome. Read [`PLAN.md`](PLAN.md) first, since it defines the V1 scope.

## License

<!-- TODO: choose a project license and add a LICENSE file at the repository root. app/LICENSE is the Expo template's license (650 Industries), not this project's. -->

No license has been chosen yet.

Third-party components keep their own licenses: MapLibre GL JS (BSD-3-Clause), Noto Sans glyphs (SIL Open Font License 1.1), and map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
