# Nomad Milestone 2 — Test Firmware

Two **separate**, minimal PlatformIO projects for the hardware-validation bench
tests. They are test instruments, not the product firmware: they exist to
produce numbers for [MILESTONE-2-PREP.md](../../MILESTONE-2-PREP.md) §3/§7.

| Project | What it validates | Phone needed |
| :--- | :--- | :--- |
| [`espnow_two_way/`](./espnow_two_way/) | Board ↔ board ESP-NOW: delivery, ACKs, duplicates, timeouts/retransmit, peer recovery, RSSI | No |
| [`ble_nus/`](./ble_nus/) | Phone ↔ board BLE over the Nordic UART Service (exact PLAN.md §3 UUIDs), echo round-trip, reconnect, MTU | Yes (nRF Connect) |

**Status: written, NOT yet compile-verified.** Neither Python nor PlatformIO is
installed on this PC. Compiling both projects is step 1 of the Monday
checklist — do it before anything else; expect possibly a round of API-fix
compiles (a normal first-build pass, not a test failure).

## Board target

- **Board:** ESP32-C3 SuperMini (USB-C, 4 MB flash assumed)
- **PlatformIO id:** `esp32-c3-devkitm-1`
- The SuperMini has **no USB-UART bridge** — its USB port is the C3's native
  USB-Serial/JTAG. Both `platformio.ini` files set `ARDUINO_USB_MODE=1` and
  `ARDUINO_USB_CDC_ON_BOOT=1`; without them `Serial` prints nothing over USB.
- Same sketch on **both** boards for the ESP-NOW project. Identify A and B by
  the MAC each prints at boot (`id` command reprints it).

## Toolchain setup (step 1, Monday — or tonight if desired)

```powershell
# 1. Python 3.11–3.13 from python.org ("Add python.exe to PATH"), then:
python -m pip install --upgrade platformio
pio --version

# 2. Compile both projects (downloads the espressif32 platform + toolchain,
#    roughly 0.5–1 GB the first time — expect a few minutes):
cd Nomad\firmware\espnow_two_way
pio run
cd ..\ble_nus
pio run
```

Platform version is pinned in each `platformio.ini` (pioarduino stable =
Arduino 3.3.12 / ESP-IDF 5.5.5, includes Espressif's 2025 ESP-NOW+BLE
coexistence fixes). The commented fallback line switches to the official
PlatformIO platform if the pioarduino download is blocked.

## Flashing & monitoring

```powershell
cd Nomad\firmware\espnow_two_way
pio run -t upload          # add -d <COMx> if more than one device is plugged in
pio device monitor         # 115200 baud; set line ending to "Newline"
```

Repeat for `ble_nus` on the board being tested. **Close other programs holding
the port** (VS Code serial extensions, Arduino IDE) if upload fails.

Capture logs for the results spreadsheet:

```powershell
pio device monitor | Out-File ..\..\test-logs\stage2_run1.txt   # PowerShell
```

## Command quick reference

`espnow_two_way` (type on **both** boards' monitors):

| Command | Effect |
| :--- | :--- |
| `id` | MAC, channel, learned peer, time since last peer frame |
| `send 1000 50` | reset counters, send 1000 numbered packets at 50 ms gaps → prints per-packet `RX/DUP/ACK/TO/LOST` lines and a final `--- STATS ---` summary with delivery %, retransmits, duplicates, RTT min/avg/max |
| `stats` / `reset` | reprint / zero counters |

`ble_nus`:

| Command | Effect |
| :--- | :--- |
| `id` | name, connection count, MTU, subscribe state |
| `notify <text>` | manual notification push to the phone |
| `adv on\|off` | advertising control (reconnect tests) |
| `stats` | writes/notifies/connects/disconnects counters |

## Expected first-run outputs (NOT results — these are what "working" looks like)

- ESP-NOW boot: `MAC=.. channel: 1 mode: STA (no AP)`; after `send 100 50` on
  board A while board B idles: B prints `[RX ] seq=… rssi=…`, A prints
  `[TX ] seq=… acked rtt=…`, summary `delivery=100.00%` *would* be a pass —
  any real number gets recorded as-is in the results CSV.
- BLE: phone scans `NomadNUS` → connect → enable notify on `6E400003` → write
  `PING` to `6E400002` → phone receives `ECHO:PING`, board shows
  `[GATT] write 4 bytes` + `notified 9 bytes`, and `MTU=128`.

## Troubleshooting

| Symptom | Likely cause |
| :--- | :--- |
| Upload fails / no COM port | Power-only USB-C cable, or missing driver for the native USB-Serial/JTAG (Espressif USB driver) |
| COM port found but monitor empty | `ARDUINO_USB_CDC_ON_BOOT=1` missing from build flags, or monitor at wrong baud (must be 115200) |
| Monitor opens, board seems frozen | DTR toggle during monitor open can hold the C3 in reset — press the board's RST button |
| `esp_now_send err=ESP_ERR_ESPNOW_CHAN` | The two boards are on different channels — reflash both, don't mix modified channel builds |
| ESP-NOW RX always 0 while BLE connected | Coexistence failure → MILESTONE-2-PREP.md §5.3 mitigation ladder (this is a *test outcome*, log it) |
