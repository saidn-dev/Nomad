// ---------------------------------------------------------------------------
// Nomad Milestone 2 — BLE (Nordic UART Service) peripheral test firmware
//
// PURPOSE: validate the phone <-> board half of the Nomad architecture on its
// own, BEFORE any ESP-NOW involvement. A phone connects over BLE, discovers the
// Nordic UART Service (NUS), writes a short message, and receives an echo
// notification back — proving both directions plus subscription handling.
//
// BOARD:  ESP32-C3 SuperMini (PlatformIO: esp32-c3-devkitm-1), Arduino framework
//         + NimBLE-Arduino 2.5.x ("lightweight BLE stack", PLAN.md §5).
// FLASH:  this sketch only. The phone side needs NO app changes: use the
//         nRF Connect for Mobile app (see MILESTONE-2-PREP.md §6/§7).
//
// GATT CONTRACT (identical UUIDs to PLAN.md §3 — Milestone 3's app must find
// exactly this service when it is written in JavaScript):
//   Service   6E400001-B5A3-F393-E0A9-E50E24DCCA9E   Nordic UART Service
//   Phone->brd 6E400002-B5A3-F393-E0A9-E50E24DCCA9E   Write / Write No Response
//             (PLAN.md names this "TX")
//   Brd->phone 6E400003-B5A3-F393-E0A9-E50E24DCCA9E   Notify
//             (PLAN.md names this "RX")
//   MTU requested: 128 bytes (PLAN.md §3: whole CSV frame in one L2CAP packet)
//
// BEHAVIOR: every write is echoed back as "ECHO:<written bytes>" (capped to the
// negotiated MTU), so one phone alone proves the round trip. Advertising
// restarts automatically after a disconnect — that is the reconnect test.
//
// CONEX_NOTE: on connect the board REQUESTS 100-200 ms connection intervals
// (PLAN.md §6 initial coexistence mitigation: long, predictable radio-idle
// windows for ESP-NOW). The phone is the central and may override this — the
// actual interval must be read back from nRF Connect during stage-4 tests.
//
// SERIAL COMMANDS (115200 baud, Newline or Both NL & CR):
//   help             list commands
//   id               name + connection/MTU status
//   adv on|off       start/stop advertising manually
//   notify <text>    push a notification to the connected phone (manual test)
//   stats            counters (writes, notifies, connects, disconnects)
//
// STATUS: written against NimBLE-Arduino 2.5.x APIs (signatures verified
// against the class reference), NOT YET COMPILE-VERIFIED — PlatformIO is not
// installed on this PC. Compiling it is step 1 of the Monday checklist
// (MILESTONE-2-PREP.md §6).
// ---------------------------------------------------------------------------

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <string>

#define NUS_SERVICE_UUID    "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define PHONE_TO_BOARD_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define BOARD_TO_PHONE_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Legacy advertising payloads hold 31 bytes:
//   flags(3) + 128-bit service uuid(18) + name header(2) = 23  ->  name <= 8.
// A longer name would be silently truncated or push the uuid out of the payload,
// and then nRF Connect could no longer filter scanners by service.
#define DEVICE_NAME "NomadNUS"

static NimBLEServer *server = nullptr;
static NimBLECharacteristic *phoneToBoard = nullptr;
static NimBLECharacteristic *boardToPhone = nullptr;

static uint16_t lastMtu = 23;          // until the central negotiates
static bool subscribed = false;        // central subscribed to BOARD_TO_PHONE
static uint32_t gWrites = 0, gNotifies = 0, gConnects = 0, gDisconnects = 0;

// --- helpers -----------------------------------------------------------------
static void printValue(const char *tag, const std::string &v) {
  if (v.empty()) {
    Serial.printf("%s (empty)\n", tag);
    return;
  }
  bool printable = true;
  for (unsigned char c : v) {
    if ((c < 0x20 || c > 0x7E) && c != '\r' && c != '\n' && c != '\t') {
      printable = false;
      break;
    }
  }
  if (printable) {
    Serial.printf("%s \"%.*s\"\n", tag, (int)v.size(), v.data());
  } else {
    Serial.printf("%s hex:", tag);
    for (size_t i = 0; i < v.size(); i++) Serial.printf(" %02X", (uint8_t)v[i]);
    Serial.println();
  }
}

// --- callbacks (NimBLE-Arduino 2.5.x signatures) -----------------------------
class PhoneToBoardCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    std::string v = c->getValue();   // NimBLEAttValue converts to std::string
    gWrites++;
    Serial.printf("[GATT] write %u bytes [%lu ms]\n",
                  (unsigned)v.size(), (unsigned long)millis());
    printValue("      ", v);

    if (!subscribed) {
      Serial.println("      echo skipped: central not subscribed to notify char");
      return;
    }
    // Echo the same bytes behind a prefix so the round trip is obvious in
    // nRF Connect. Cap to (MTU - 3 ATT overhead - 5 prefix bytes): NimBLE will
    // not fragment notifications, so an oversized value would be dropped.
    std::string echo = std::string("ECHO:") + v;
    size_t cap = lastMtu > 8 ? (size_t)(lastMtu - 3 - 5) : 0;
    if (echo.size() > cap) echo.resize(cap);
    boardToPhone->setValue(echo);
    if (boardToPhone->notify()) {
      gNotifies++;
      Serial.printf("      notified %u bytes\n", (unsigned)echo.size());
    } else {
      Serial.println("      notify() FAILED");
    }
  }

  void onSubscribe(NimBLECharacteristic *, NimBLEConnInfo &, uint16_t subValue) override {
    subscribed = (subValue & 0x01) != 0;
    Serial.printf("[GATT] notifications %s (subValue=%u)\n",
                  subscribed ? "ON" : "OFF", subValue);
  }
};

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s, NimBLEConnInfo &conn) override {
    gConnects++;
    uint16_t h = conn.getConnHandle();
    Serial.printf("[GATT] CONNECT handle=%u [%lu ms]\n",
                  h, (unsigned long)millis());
    // Initial coexistence mitigation (PLAN.md §6): long connection intervals
    // give ESP-NOW wide, predictable idle windows on the shared radio.
    // Units: interval 1.25 ms (80..160 => 100..200 ms), latency 0 packets,
    // supervision timeout 10 ms (400 => 4 s). Central may override — verify
    // the effective interval in nRF Connect, don't assume it took.
    s->updateConnParams(h, 80, 160, 0, 400);
  }

  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int reason) override {
    gDisconnects++;
    subscribed = false;
    // advertiseOnDisconnect(true) is set in setup() — NimBLE 2.x does NOT
    // restart advertising on its own; without it a reconnect test would hang.
    Serial.printf("[GATT] DISCONNECT reason=%d [%lu ms] (re-advertise is ON)\n",
                  reason, (unsigned long)millis());
  }

  void onMTUChange(uint16_t mtu, NimBLEConnInfo &) override {
    lastMtu = mtu;
    Serial.printf("[GATT] MTU=%u (max payload %u bytes)\n",
                  mtu, mtu > 3 ? mtu - 3 : 0);
  }
};

// --- serial command interface ------------------------------------------------
static void handleCommand(char *cmd) {
  char *sp = strchr(cmd, ' ');
  const char *args = nullptr;              // capture before strtok splits
  if (sp != nullptr) {
    args = sp + 1;
    while (*args == ' ') args++;           // tolerate "notify  hello"
    if (*args == '\0') args = nullptr;
  }
  char *tok = strtok(cmd, " ");
  if (tok == nullptr) return;

  if (strcmp(tok, "help") == 0) {
    Serial.println("Commands: id | adv on|off | notify <text> | stats | help");
  } else if (strcmp(tok, "id") == 0) {
    Serial.printf("name=%s connected=%u mtu=%u subscribed=%d uptime=%lums\n",
                  DEVICE_NAME, (unsigned)server->getConnectedCount(),
                  lastMtu, subscribed ? 1 : 0, (unsigned long)millis());
  } else if (strcmp(tok, "adv") == 0) {
    if (args && strcmp(args, "on") == 0) {
      NimBLEDevice::startAdvertising();
      Serial.println("[OK] advertising started");
    } else if (args && strcmp(args, "off") == 0) {
      NimBLEDevice::stopAdvertising();
      Serial.println("[OK] advertising stopped");
    } else {
      Serial.println("[BAD] usage: adv on|off");
    }
  } else if (strcmp(tok, "notify") == 0) {
    if (args == nullptr || *args == '\0') {
      Serial.println("[BAD] usage: notify <text>");
      return;
    }
    if (server->getConnectedCount() == 0) {
      Serial.println("[GATT] no central connected — nothing to notify");
      return;
    }
    std::string text(args);
    boardToPhone->setValue(text);
    if (boardToPhone->notify()) {
      gNotifies++;
      Serial.print("[TX ] manual notify ");
      printValue("", text);
    } else {
      Serial.println("[TX ] notify() FAILED (central not subscribed?)");
    }
  } else if (strcmp(tok, "stats") == 0) {
    Serial.println("--- STATS ----------------------------------------");
    Serial.printf(" writes=%lu notifies=%lu connects=%lu disconnects=%lu\n",
                  (unsigned long)gWrites, (unsigned long)gNotifies,
                  (unsigned long)gConnects, (unsigned long)gDisconnects);
    Serial.printf(" connected=%u mtu=%u subscribed=%d\n",
                  (unsigned)server->getConnectedCount(), lastMtu,
                  subscribed ? 1 : 0);
    Serial.println("------------------------------------------------");
  } else {
    Serial.printf("[?] unknown command '%s' — try 'help'\n", tok);
  }
}

// --- setup / loop ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(128);   // PLAN.md §3: 128-byte MTU target

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);   // required: 2.x default is OFF

  NimBLEService *svc = server->createService(NUS_SERVICE_UUID);
  phoneToBoard = svc->createCharacteristic(
      PHONE_TO_BOARD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  phoneToBoard->setCallbacks(new PhoneToBoardCallbacks());
  boardToPhone = svc->createCharacteristic(
      BOARD_TO_PHONE_UUID, NIMBLE_PROPERTY::NOTIFY);
  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);   // lets nRF Connect filter by service
  adv->setName(DEVICE_NAME);               // 2.1.0+ does not add the name for us
  NimBLEDevice::startAdvertising();

  Serial.println("==================================================");
  Serial.println(" Nomad M2 — BLE NUS peripheral  (NOT A PASSED TEST)");
  Serial.printf(" name=%s service=%s\n", DEVICE_NAME, NUS_SERVICE_UUID);
  Serial.printf(" phone->board=%s\n", PHONE_TO_BOARD_UUID);
  Serial.printf(" board->phone=%s (notify)\n", BOARD_TO_PHONE_UUID);
  Serial.printf(" build: %s %s\n", __DATE__, __TIME__);
  Serial.println(" connect with nRF Connect, enable notifications on the");
  Serial.println(" 6E400003 char, write to 6E400002, expect 'ECHO:...'");
  Serial.println(" type 'help' for commands");
  Serial.println("==================================================");
}

void loop() {
  static char line[96];
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
}
