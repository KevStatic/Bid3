# Bid3 hardware firmware

V2 source for two Seeed XIAO ESP32-C3 bidder tags and an ESP32-WROOM gateway.
Imported from `Bid3_Firmware_V2_2026-11-06.zip` on 6 November 2026. Runtime
behavior, public identity pins, wiring and NVS namespaces are preserved. Tag
packet initialization uses C++ value initialization, and explicit notification
descriptors are added only for Bluedroid; NimBLE creates its descriptor itself.

## Hardware targets

| Device | Sketch | Arduino FQBN | Serial baud |
| --- | --- | --- | ---: |
| Physical tag 01 | `Tag01/Tag01.ino` | `esp32:esp32:XIAO_ESP32C3` | 115200 |
| Physical tag 02 | `Tag02/Tag02.ino` | `esp32:esp32:XIAO_ESP32C3` | 115200 |
| Gateway | `Gateway/Gateway.ino` | `esp32:esp32:esp32` | 460800 |

Use **Arduino CLI 1.5.1**, **Espressif ESP32 core 3.3.12** and the default
application partition. BLE, FreeRTOS, Preferences and mbedTLS come with that
core. Keep the headers beside each `.ino` when opening it in Arduino IDE.
Upload each tag sketch only to its matching physical tag. Preserve NVS; do
not erase all flash during a normal update.

`shared/` contains canonical tag/common headers. The matching files beside
the sketches allow standalone Arduino IDE uploads. Change the canonical
file and synchronize its copies together; the validation command detects drift.

## Wiring and operation

Read [START_HERE.md](START_HERE.md) for wiring, identity pinning, upload steps
and expected serial diagnostics. The tag LED follows its slide switch; gateway
lights and sound provide auction feedback. Both BLE links connect before an
engine session is armed. Private identities remain on the devices in NVS;
the checked-in enrollment values are public keys and fingerprints.

## Build and validate

Run from this directory with Python 3.10 or newer and Clang installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python tools/check.py
```

The check verifies every release checksum, all shared-header copies, all Python
signature/policy tests and all ten C++ regression programs with warnings as
errors, AddressSanitizer and UndefinedBehaviorSanitizer. Build products use
temporary directories; environments and caches are ignored by Git.

With Arduino CLI 1.5.1 installed, provision the pinned board package once:

```sh
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.3.12 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
python3 tools/build.py
```

Pass `--arduino-cli /absolute/path/to/arduino-cli` for a CLI bundled with Arduino
IDE, or `--sketch Gateway` to compile one target. These commands compile only;
select the correct device and port in Arduino IDE to upload. The repository's
`Firmware` workflow runs the same checks and compiles all three targets on
hardware changes. See [VALIDATION.md](VALIDATION.md) for validation evidence
and the physical acceptance work still needed.

After reviewing intentional changes, update the manifest and rerun checks:

```sh
python3 tools/check.py --update-checksums
python3 tools/check.py
```

## Backend integration status

**This V2 firmware does not yet interoperate with the repository's existing
`bridge/bid3_bridge.py`.** BLE discovery and connection can be tested independently.

| Contract | V2 firmware | Existing bridge/engine |
| --- | --- | --- |
| USB transport | 460800 baud | 115200 default |
| Events | `BID3_EVENT_JSON`, signed intents and sessions | `AUCTION_EVENT_JSON` |
| Control | `BID3 ARM/STATE/DECIDE/RESULT`, periodic `PING` | `AUCTION_STATE_JSON`, `AUCTION_ACK_JSON`, `CMD=STATUS` |
| Quote freshness | Round-bound `quoteVersion` | `stateVersion` |
| Hammer policy | 10000 ms reference policy | 5000 ms engine default |

The existing bridge ignores V2 event prefixes. Changing baud alone is
insufficient. A coordinated bridge/engine update must implement the V2
[ENGINE_PROTOCOL.md](ENGINE_PROTOCOL.md), bind and verify sessions/intents,
map authoritative decisions, align the countdown/rules hash and recover paused
after faults. That integration is outside this hardware import. The engine
remains the sole authority for acceptance, countdown and result persistence;
the gateway never creates a winner when the backend is absent.

The Python rules module is a host reference for firmware integration tests,
not a deployed replacement for the engine. See [RULES.md](RULES.md) and
[LATENCY_AND_SYNC.md](LATENCY_AND_SYNC.md) for the V2 policy and measurement
procedure. `legacy_docs/` and legacy protocol tests are retained for identity
and regression history; they do not define the active V2 transport.

No devices have been flashed or bench-tested as part of this repository import.
RF reliability, heap/stack margins, sound/light timing and a real auction round
remain hardware acceptance work. The font attribution is in
[FONT_LICENSE.txt](FONT_LICENSE.txt); the repository license also applies.
