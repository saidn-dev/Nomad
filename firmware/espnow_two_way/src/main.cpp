// ---------------------------------------------------------------------------
// Nomad Milestone 2 — ESP-NOW two-way bench-test firmware
//
// PURPOSE: hardware-independent validation of the board-to-board radio link
// before any MVP work. Measures packet delivery, acknowledgements, duplicate
// handling, timeouts/retransmission, peer recovery and (via RSSI) rough range.
//
// BOARD:  ESP32-C3 SuperMini (PlatformIO: esp32-c3-devkitm-1), Arduino framework.
// FLASH:  this SAME sketch on both boards. No wiring required — boards talk
//         over 2.4 GHz ESP-NOW on a fixed Wi-Fi channel (default 1).
//
// FRAME FORMAT (CSV, same style as the Nomad wire protocol in PLAN.md §4):
//   BCN,<seq>   periodic beacon, broadcast to FF:FF:FF:FF:FF:FF (peer discovery
//               + liveness; a silent peer for 5 s prints a PEER LOST warning)
//   DAT,<seq>   numbered test packet, broadcast; sender retransmits on timeout
//   ACK,<seq>   unicast acknowledgement, sent to the source MAC of the DAT
//
// WHY APP-LEVEL ACK/DEDUP: Espressif's ESP-NOW docs state delivery is NOT
// guaranteed and explicitly recommend sequence numbers + ACK + retransmit at
// the application layer. That is exactly what this sketch implements, and it
// doubles as the prototype for Milestone 4's reliability layer.
//
// SERIAL COMMANDS (115200 baud, line ending: Newline or Both NL & CR):
//   help             list commands
//   id               print MAC, channel, peer status, counters
//   send <n> [gap]   run a test: n numbered packets (default 100), gap ms
//                    (default 50). Resets counters first. 1000 @ 50 ms is the
//                    milestone-2 baseline run.
//   stats            print current counters + delivery rate
//   reset            zero counters (tx sequence numbers keep increasing)
//
// LIMITATIONS (documented on purpose, bench-test scope):
//   - ACK matching is by sequence number only; run `send` from ONE board at a
//     time (the other board only receives and acknowledges).
//   - No encryption (ESP-NOW LMK), matches PLAN.md §8 V1 cut: crypto.
//   - Single peer. Extra boards are logged but not tracked.
//
// STATUS: written against ESP-IDF 4.4 / 5.0 / 5.5 callback APIs (see shims
// below), NOT YET COMPILE-VERIFIED — PlatformIO is not installed on this PC.
// Compiling it is step 1 of the Monday checklist (MILESTONE-2-PREP.md §6).
// ---------------------------------------------------------------------------

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <esp_idf_version.h>

// --- ESP-NOW callback API shims ---------------------------------------------
// ESP-IDF 5.0 changed the receive callback's first parameter from a bare MAC
// pointer to esp_now_recv_info_t (adds destination address + RX control/RSSI).
// ESP-IDF 5.5 changed the send callback's first parameter from a bare MAC
// pointer to esp_now_send_info_t. Arduino core 2.0.x = IDF 4.4 (old/old),
// core 3.0-3.2 = IDF 5.1-5.4 (new/old), core 3.3+ = IDF 5.5 (new/new).
#if ESP_IDF_VERSION_MAJOR >= 5
#  define RX_SIGNATURE const esp_now_recv_info_t *info, const uint8_t *data, int len
#  define RX_SRC      (info->src_addr)
#  define HAS_RSSI     1
#  define RX_RSSI      (info->rx_ctrl != nullptr ? info->rx_ctrl->rssi : 0)
#else
#  define RX_SIGNATURE const uint8_t *src_addr, const uint8_t *data, int len
#  define RX_SRC      (src_addr)
#  define HAS_RSSI     0
#  define RX_RSSI      0
#endif

#if (ESP_IDF_VERSION_MAJOR > 5) || (ESP_IDF_VERSION_MAJOR == 5 && ESP_IDF_VERSION_MINOR >= 5)
#  define TX_SIGNATURE const esp_now_send_info_t *tx_info, esp_now_send_status_t status
#  define TX_DST       (tx_info != nullptr ? tx_info->des_addr : (const uint8_t *)nullptr)
#else
#  define TX_SIGNATURE const uint8_t *dst_addr, esp_now_send_status_t status
#  define TX_DST       (dst_addr)
#endif

// --- configuration -----------------------------------------------------------
static const uint8_t  WIFI_CHANNEL    = 1;      // MUST match on both boards (1/6/11 recommended)
static const uint32_t BEACON_PERIOD_MS = 1000;
static const uint32_t ACK_TIMEOUT_MS   = 150;   // per attempt
static const uint8_t  MAX_ATTEMPTS     = 3;     // 1 try + 2 retransmissions
static const uint32_t PEER_TIMEOUT_MS  = 5000;  // beacon silence -> PEER LOST
static const uint8_t  BCAST[6]        = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// --- state -------------------------------------------------------------------
static uint8_t  myMac[6];
static char     myMacStr[18];
static uint8_t  peerMac[6];
static bool     peerKnown = false;
static uint32_t lastPeerSeenMs = 0;
static uint32_t beaconSeq = 0;
static uint32_t txSeq = 0;             // monotonic for the lifetime of the firmware

// cumulative counters (zeroed by `send`/`reset`, never by boot)
static uint32_t stSent = 0, stAcked = 0, stLost = 0, stRetrans = 0;
static uint32_t stLateAck = 0, stRxData = 0, stRxBeacon = 0, stDup = 0;
static uint32_t stTxFail = 0;
static uint32_t rttMin = UINT32_MAX, rttMax = 0, rttSum = 0;

// in-flight packet (single outstanding, matches the one-peer bench scope)
static bool     inflight = false;
static uint32_t inflightSeq = 0;
static uint32_t inflightSentAt = 0;
static uint8_t  inflightTries = 0;

// test driver
static bool     testing = false;
static uint32_t testTarget = 0;
static uint32_t testGapMs = 50;
static uint32_t nextSendAtMs = 0;

// duplicate detection: ring of the last 64 received sequence numbers (full
// 32-bit values, so wrap-around or resets on the sender can never alias).
// 64 slots comfortably covers a retransmission, which arrives within
// MAX_ATTEMPTS * ACK_TIMEOUT_MS = 450 ms (~10 packet slots at 50 ms gap).
static uint32_t recentSeq[64];
static uint8_t  recentIdx = 0, recentCount = 0;

// --- helpers -----------------------------------------------------------------
static void macToStr(const uint8_t *mac, char *out) {
  sprintf(out, "%02X:%02X:%02X:%02X:%02X:%02X",
          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void learnPeer(const uint8_t *mac) {
  if (!peerKnown || memcmp(peerMac, mac, 6) != 0) {
    memcpy(peerMac, mac, 6);
    char s[18];
    macToStr(mac, s);
    Serial.printf("[PEER] learned %s\n", s);
  }
  peerKnown = true;
  lastPeerSeenMs = millis();
}

static void ensurePeer(const uint8_t *mac) {
  if (esp_now_is_peer_exist(mac)) return;
  esp_now_peer_info_t p = {};
  memcpy(p.peer_addr, mac, 6);
  p.channel = 0;          // 0 = follow the current Wi-Fi channel
  p.ifidx = WIFI_IF_STA;
  p.encrypt = false;      // no LMK: crypto is an explicit V1 cut (PLAN.md §8)
  if (esp_now_add_peer(&p) != ESP_OK) {
    Serial.printf("[WARN] esp_now_add_peer failed for %02X:%02X:%02X:%02X:%02X:%02X\n",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }
}

static bool wasRecentlySeen(uint32_t seq) {
  for (uint8_t i = 0; i < recentCount; i++) {
    if (recentSeq[i] == seq) return true;
  }
  return false;
}

static void markSeen(uint32_t seq) {
  recentSeq[recentIdx] = seq;
  recentIdx = (recentIdx + 1) % 64;
  if (recentCount < 64) recentCount++;
}

static bool sendFrame(const char *type, uint32_t seq, const uint8_t *dest) {
  char buf[48];
  int n = snprintf(buf, sizeof(buf), "%s,%lu", type, (unsigned long)seq);
  esp_err_t err = esp_now_send(dest, (const uint8_t *)buf, n);
  if (err != ESP_OK) {
    Serial.printf("[TX!] %s,%lu esp_now_send err=%d\n",
                  type, (unsigned long)seq, (int)err);
    return false;
  }
  return true;
}

static void printStats(const char *why) {
  uint32_t resolved = stAcked + stLost;
  double pct = resolved ? (100.0 * stAcked) / resolved : 0.0;
  uint32_t avg = stAcked ? rttSum / stAcked : 0;
  Serial.println("--- STATS ----------------------------------------");
  Serial.printf(" %s\n", why);
  Serial.printf(" sent=%lu acked=%lu lost=%lu delivery=%.2f%%\n",
                (unsigned long)stSent, (unsigned long)stAcked,
                (unsigned long)stLost, pct);
  Serial.printf(" retrans=%lu lateAck=%lu dupDetected=%lu txFail=%lu\n",
                (unsigned long)stRetrans, (unsigned long)stLateAck,
                (unsigned long)stDup, (unsigned long)stTxFail);
  Serial.printf(" rxData=%lu rxBeacon=%lu\n",
                (unsigned long)stRxData, (unsigned long)stRxBeacon);
  if (stAcked) {
    Serial.printf(" rtt ms: min=%lu avg=%lu max=%lu\n",
                  (unsigned long)(rttMin == UINT32_MAX ? 0 : rttMin),
                  (unsigned long)avg, (unsigned long)rttMax);
  }
  Serial.println("------------------------------------------------");
}

static void resetCounters() {
  stSent = stAcked = stLost = stRetrans = 0;
  stLateAck = stRxData = stRxBeacon = stDup = stTxFail = 0;
  rttMin = UINT32_MAX; rttMax = 0; rttSum = 0;
  recentIdx = recentCount = 0;
  memset(recentSeq, 0, sizeof(recentSeq));
}

// --- ESP-NOW callbacks -------------------------------------------------------
static void onReceive(RX_SIGNATURE) {
  if (RX_SRC == nullptr || data == nullptr || len <= 0) return;
  char buf[256];
  if (len > (int)sizeof(buf) - 1) len = sizeof(buf) - 1;
  memcpy(buf, data, len);
  buf[len] = '\0';
  uint32_t now = millis();

  char *end = nullptr;
  if (strncmp(buf, "BCN,", 4) == 0) {
    uint32_t seq = strtoul(buf + 4, &end, 10);
    if (end == buf + 4) return;
    stRxBeacon++;
    learnPeer(RX_SRC);
    Serial.printf("[BCN ] seq=%lu rssi=%s [%lu ms]\n", (unsigned long)seq,
                  HAS_RSSI ? String(RX_RSSI).c_str() : "-", (unsigned long)now);
    return;
  }

  if (strncmp(buf, "DAT,", 4) == 0) {
    uint32_t seq = strtoul(buf + 4, &end, 10);
    if (end == buf + 4) return;
    stRxData++;
    learnPeer(RX_SRC);
    if (wasRecentlySeen(seq)) {
      stDup++;
      // Still acknowledged: an ACK is idempotent, and the sender may have
      // retransmitted precisely because its previous ACK was lost.
      Serial.printf("[DUP] seq=%lu duplicate ignored (counted, not reprocessed)\n",
                    (unsigned long)seq);
    } else {
      markSeen(seq);
      Serial.printf("[RX ] seq=%lu from=%02X:%02X:%02X:%02X:%02X:%02X rssi=%s\n",
                    (unsigned long)seq, RX_SRC[0], RX_SRC[1], RX_SRC[2],
                    RX_SRC[3], RX_SRC[4], RX_SRC[5],
                    HAS_RSSI ? String(RX_RSSI).c_str() : "-");
    }
    ensurePeer(RX_SRC);
    sendFrame("ACK", seq, RX_SRC);   // unicast back to the DAT's source
    return;
  }

  if (strncmp(buf, "ACK,", 4) == 0) {
    uint32_t seq = strtoul(buf + 4, &end, 10);
    if (end == buf + 4) return;
    learnPeer(RX_SRC);
    if (inflight && seq == inflightSeq) {
      uint32_t rtt = now - inflightSentAt;
      stAcked++;
      if (rtt < rttMin) rttMin = rtt;
      if (rtt > rttMax) rttMax = rtt;
      rttSum += rtt;
      Serial.printf("[TX ] seq=%lu acked try=%u rtt=%lums\n",
                    (unsigned long)seq, inflightTries, (unsigned long)rtt);
      inflight = false;
    } else {
      // ACK arrived after we gave up (or after a duplicate was ACKed again):
      // informative, not fatal — but a high count means the timeout is too tight.
      stLateAck++;
      Serial.printf("[ACK] late/unexpected seq=%lu\n", (unsigned long)seq);
    }
    return;
  }

  Serial.printf("[RX?] unknown frame: %.32s\n", buf);
}

static void onSend(TX_SIGNATURE) {
  if (status == ESP_NOW_SEND_FAIL) {
    stTxFail++;
    const uint8_t *dst = TX_DST;
    char s[18] = "??:??:??:??:??:??";
    if (dst != nullptr) macToStr(dst, s);
    Serial.printf("[TX!] send fail -> %s\n", s);
  }
}

// --- test driver -------------------------------------------------------------
static void finishTest() {
  testing = false;
  char why[64];
  snprintf(why, sizeof(why), "test run complete: %lu packets",
           (unsigned long)testTarget);
  printStats(why);
}

static void serviceTest(uint32_t now) {
  if (inflight && (now - inflightSentAt) >= ACK_TIMEOUT_MS) {
    if (inflightTries < MAX_ATTEMPTS) {
      inflightTries++;
      stRetrans++;
      Serial.printf("[TO ] seq=%lu no ack, retransmit %u/%u\n",
                    (unsigned long)inflightSeq,
                    (uint8_t)(inflightTries - 1), (uint8_t)(MAX_ATTEMPTS - 1));
      inflightSentAt = now;
      sendFrame("DAT", inflightSeq, BCAST);
    } else {
      stLost++;
      Serial.printf("[LOST] seq=%lu after %u attempts\n",
                    (unsigned long)inflightSeq, inflightTries);
      inflight = false;
    }
    return;   // do not start a new packet in the same tick as a resolution
  }

  if (testing && !inflight) {
    if (stSent >= testTarget) {
      finishTest();
    } else if (now >= nextSendAtMs) {
      txSeq++;
      inflight = true;
      inflightSeq = txSeq;
      inflightTries = 1;
      inflightSentAt = now;
      nextSendAtMs = now + testGapMs;
      stSent++;
      sendFrame("DAT", inflightSeq, BCAST);
    }
  }
}

// --- serial command interface ------------------------------------------------
static void handleCommand(char *cmd) {
  char *tok = strtok(cmd, " ");

  if (tok == nullptr) return;

  if (strcmp(tok, "help") == 0) {
    Serial.println("Commands: id | send <n> [gap_ms] | stats | reset | help");
  } else if (strcmp(tok, "id") == 0) {
    char p[18] = "??:??:??:??:??:??";
    if (peerKnown) macToStr(peerMac, p);
    Serial.printf("MAC=%s channel=%u peer=%s lastPeerSeen=%lums\n",
                  myMacStr, WIFI_CHANNEL, p,
                  (unsigned long)(peerKnown ? millis() - lastPeerSeenMs : 0));
  } else if (strcmp(tok, "send") == 0) {
    if (inflight || testing) {
      Serial.println("[BUSY] test already running — wait for the summary");
      return;
    }
    char *nArg = strtok(nullptr, " ");
    char *gArg = strtok(nullptr, " ");
    long n = nArg ? atol(nArg) : 100;
    long g = gArg ? atol(gArg) : 50;
    if (n <= 0 || n > 100000 || g < 10 || g > 10000) {
      Serial.println("[BAD] usage: send <1..100000> [10..10000 ms gap]");
      return;
    }
    resetCounters();
    testing = true;
    testTarget = (uint32_t)n;
    testGapMs = (uint32_t)g;
    nextSendAtMs = millis();
    Serial.printf("[TEST] sending %ld packets every %ld ms (beacons continue)\n", n, g);
  } else if (strcmp(tok, "stats") == 0) {
    printStats("on demand");
  } else if (strcmp(tok, "reset") == 0) {
    testing = false;
    inflight = false;
    resetCounters();
    Serial.println("[OK] counters reset");
  } else {
    Serial.printf("[?] unknown command '%s' — try 'help'\n", tok);
  }
}

// --- setup / loop ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  // STA mode is REQUIRED: Espressif's RF coexistence matrix lists ESP-NOW RX
  // as "S" (supported, stable) only in Wi-Fi STA mode when BLE is active;
  // SoftAP variants are "C1" (unstable) or unsupported. We start STA without
  // ever connecting to an access point, and pin the channel ourselves.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_ps(WIFI_PS_NONE);   // modem sleep must be off to reliably RX ESP-NOW

  if (esp_now_init() != ESP_OK) {
    Serial.println("[FATAL] esp_now_init failed — check board/coexistence config");
    delay(1000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onReceive);
  esp_now_register_send_cb(onSend);
  ensurePeer(BCAST);

  esp_wifi_get_mac(WIFI_IF_STA, myMac);
  macToStr(myMac, myMacStr);

  Serial.println("==================================================");
  Serial.println(" Nomad M2 — ESP-NOW two-way test  (NOT A PASSED TEST)");
  Serial.printf(" MAC: %s   channel: %u   mode: STA (no AP)\n",
                myMacStr, WIFI_CHANNEL);
  Serial.printf(" build: %s %s\n", __DATE__, __TIME__);
  Serial.println(" type 'help' for commands");
  Serial.println("==================================================");
}

void loop() {
  uint32_t nowMs = millis();

  // 1. serial commands
  static char line[64];
  static size_t lineLen = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) {
        line[lineLen] = '\0';
        handleCommand(line);
        lineLen = 0;
      }
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }

  // 2. periodic beacon (peer discovery + liveness)
  static uint32_t nextBeaconAt = 0;
  if (nowMs >= nextBeaconAt) {
    beaconSeq++;
    sendFrame("BCN", beaconSeq, BCAST);
    nextBeaconAt = nowMs + BEACON_PERIOD_MS;
  }

  // 3. peer liveness
  if (peerKnown && (nowMs - lastPeerSeenMs) > PEER_TIMEOUT_MS) {
    peerKnown = false;
    Serial.println("[PEER] LOST — no frames for 5 s. Recovery is automatic: "
                   "beacons re-discover the peer when it returns.");
  }

  // 4. test state machine (timeouts, retransmits, completion)
  serviceTest(nowMs);
}
