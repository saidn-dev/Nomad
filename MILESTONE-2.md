# Nomad Milestone 2: ESP-NOW Hardware Validation

**Objective:** Validate the radio architecture before building the MVP.

Since the hardware has not been purchased or assembled yet, Milestone 2 begins with a bench-test plan and minimum hardware purchase — **not** Android app development.

## Intended architecture (to be validated)

This is the eventual communication path. It is not a claim that the components already work together.

```
Phone A ── BLE ──▶ ESP32 A ── ESP-NOW radio link ──▶ ESP32 B ── BLE ──▶ Phone B
(Nomad app)                                          (Nomad app)
```

ESP-NOW only covers the board-to-board radio link. It does **not** provide the phone-to-board BLE connection. Each link must be tested separately first, then the complete chain.

## 1. Minimum hardware to buy

Start with a small, low-cost bench setup. Don't buy a fleet of boards or design custom PCBs yet.

| Item | Qty | Priority | Notes |
| :--- | :--- | :--- | :--- |
| **ESP32-C3 dev board** (e.g. SuperMini — USB-C, WiFi + BLE 5, NZ stock at NZN Electronics) | 2 | Essential | Choose matching boards with built-in 2.4 GHz Wi-Fi, BLE, and USB programming. Two boards are enough to test direct ESP-NOW communication. |
| **USB data cables** (e.g. Adafruit USB-A to USB-C, ~1 m — Opencircuit) | 2 | Essential | Get the correct cable for each board. Some USB cables are power-only and cannot transfer firmware or serial logs. |
| **Breadboard + jumper wire kit** (400pt breadboard + 205 wires — Dukes Supplies) | 1 | Optional | Not needed for the first test if you're only exercising the boards' built-in wireless functions. |

> **Note on links:** the original product links came from a chat export and use temporary proxy URLs that have likely expired. Search the store names above (NZN Electronics, Opencircuit, Dukes Supplies) to find the current listings.

You can start with one Android phone and two boards. A second Android phone becomes useful when testing the complete Phone A → board A → board B → Phone B path.

## 2. The test sequence

Run the tests in this order. Each stage should pass before moving to the next.

1. **Board and firmware test**
   Flash each board, print its device ID and radio MAC address, and confirm it runs continuously without restarting unexpectedly.
   *Pass: both boards flash and run independently.*

2. **ESP-NOW link test**
   Send numbered test packets from board A to board B. Have B return acknowledgements. Test both directions and record missing, duplicate, and delayed packets.
   *Pass: reliable two-way communication at short range.*

3. **BLE test**
   Connect an Android phone to board A, send a short message, and verify the board returns a response. Repeat with board B.
   *Pass: the phone can exchange data with each board.*

4. **Combined BLE + ESP-NOW test**
   Keep the phone connected over BLE while the board sends and receives ESP-NOW packets. Measure whether the BLE connection drops or radio packets are lost.
   *Pass: both functions operate together reliably enough for the intended prototype.*

5. **End-to-end and range test**
   Send a message from phone A through both boards to phone B. Repeat at increasing distances, then test indoors and outdoors, with no internet connection.
   *Pass: delivery, acknowledgements, range, and failure behavior meet your predefined targets.*

> ⚠️ **Key technical risk — RF coexistence:** the ESP32-C3 shares radio resources between BLE and Wi-Fi-based ESP-NOW. Espressif documents coexistence behavior and operating-mode constraints, so test the combined setup early rather than assuming that two individually working links will work perfectly together.
> See: [ESP-IDF — Coexistence](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/coex.html) and [ESP-NOW](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/esp-now.html)

**Prepared for bench time:** [MILESTONE-2-PREP.md](./MILESTONE-2-PREP.md) is the execution runbook for this milestone — the T0–T8 test matrix with metric definitions, the two test-firmware projects in [`firmware/`](./firmware/), verified coexistence facts separated from assumptions, the Monday environment checklist, and PASS / INVESTIGATE / FAIL criteria with a results template. Results belong in [`test-logs/results-template.csv`](./test-logs/results-template.csv). No stage in that document has been run: every row is `NOT RUN` until boards are in hand.

## 3. What to measure

Record results in a simple spreadsheet or test log.

| Measurement | Initial target |
| :--- | :--- |
| Successful message delivery | At least 99% over 1,000 test packets at short range |
| Acknowledgements | Correctly matched to sent packet IDs |
| Duplicate handling | Duplicates detected and not treated as new ride requests |
| BLE stability | No unexplained disconnects during the combined test |
| Offline operation | Core radio communication works without internet |
| Range | Record actual distances and packet-delivery rates, not estimates |
| Recovery | Communication resumes after a temporary disconnect |

These are proposed prototype acceptance targets, not guaranteed ESP32 performance. If the initial test misses a target, diagnose the problem and repeat it before deciding whether the hardware or architecture needs to change.

## 4. Important limitation for Nomad

ESP-NOW provides direct device-to-device communication, but it does **not** automatically create a multi-hop mesh network. If Nomad needs messages to travel across multiple relay boards, that forwarding behavior will need a separate design and its own tests.
See: [ESP-IDF Programming Guide — ESP-NOW](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/esp-now.html)

## 5. Milestone 2 checklist

### Hardware validation (0 of 8)

- [ ] Choose and purchase two compatible ESP32-C3 development boards
- [ ] Flash and verify both boards
- [ ] Pass two-way ESP-NOW packet test
- [ ] Pass Android-to-board BLE test
- [ ] Pass combined BLE + ESP-NOW test
- [ ] Pass offline end-to-end message test
- [ ] Measure range and reliability
- [ ] Document results and decide whether to proceed with the MVP

---

**Recommendation:** don't build the ride-request MVP yet. First get the two boards talking reliably, then test BLE and ESP-NOW running simultaneously. That is the key technical risk to resolve before building the full communication layer.
