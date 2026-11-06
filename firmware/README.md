# Bid3 hardware firmware — V6

Uploadable Arduino sources for two Seeed XIAO ESP32-C3 bidder tags and an ESP32-WROOM gateway. V6 reuses the original owner-tested BLE advertisement format, discovery and enrolled signed button proofs, then adds authenticated persistent notifications for individual auction intents. The matching USB bridge is maintained once, in [../bridge/bid3_bridge.py](../bridge/bid3_bridge.py).

| Device | Sketch | Arduino FQBN | Serial baud |
|---|---|---|---:|
| Physical Tag 1 | [Tag01/Tag01.ino](Tag01/Tag01.ino) | esp32:esp32:XIAO_ESP32C3 | 115200 |
| Physical Tag 2 | [Tag02/Tag02.ino](Tag02/Tag02.ino) | esp32:esp32:XIAO_ESP32C3 | 115200 |
| Gateway | [Gateway/Gateway.ino](Gateway/Gateway.ino) | esp32:esp32:esp32 | 115200 |

Use **Espressif ESP32 core 3.3.12** and **Arduino CLI 1.5.1** for repeatable builds. Built-in BLE, mbedTLS, Wire, Preferences and FreeRTOS are sufficient. Keep all headers beside each .ino. Preserve enrolled NVS identities: **Erase All Flash Before Sketch Upload = Disabled**. The supplied public enrollment values match the owner's actual devices; no device private keys are checked in.

## V6 OFF / LOST correction

Switch OFF now sends its authenticated state immediately after the existing 50 ms switch debounce, hides that tag's radar dot and displays OFF / OUT OF BIDDING. The gateway no longer treats an authenticated BLE connection as bidding availability. An abrupt disconnect or heartbeat timeout displays LOST, rather than retaining the old 25-second proof-freshness availability. The existing 1.5-second established-session loss timeout remains.

OFF drops unsent BID/JOIN work, including a press waiting through an OFF/ON cycle. A transport failure discards old-session work on re-authentication. In-flight bids use the engine's recorded result; accepted bids remain binding and can still win after OFF or a tag fault. The V5 button-input path, startup melody, static tag LEDs, radio format, signed bid format, pricing and countdown length are retained.

The matching engine policy change is in [../engine/bid3_engine/auction.py](../engine/bid3_engine/auction.py). It makes a tag-specific fault UNKNOWN and blocks that bidder while others continue. LINK OK does not admit them; a fresh JOIN is required. Deploy that change for the complete fault policy. Bridge/gateway-wide failures retain the existing whole-room pause/recovery policy. No web frontend or Arkiv schema change is required.

## Immediate button display

V5 sends an 80-byte session-HMAC input receipt from the tag's 2 ms button sampler after the existing 30 ms debounce. A dedicated gateway task checks it without waiting for ECDSA, GATT control writes or the engine. The OLED shows BUTTON PRESSED, tag number, count and DOWN/UP; it can interrupt a queued animation frame and startup. An 80 ms minimum input overlay prevents a fast engine result from erasing all visible press feedback. Only a separate engine ACK means BID ACCEPTED.

Offline JOIN/LEAVE receives a local RECEIVED acknowledgement, which is not admission. This keeps the link alive for button diagnostics without the old 3-second reconnect loop. Valid price bids remain individually signed. The existing bridge and signed-intent format stay compatible; upload the matching V6 sketches to all three boards.

## Upload and operate

Read [START_HERE.md](START_HERE.md) for wiring, upload steps and automatic diagnostics. Radio discovery needs no ESP RESET/BOOT button, USB arm command or GPIO33. Original authentication precedes FAST_READY. An offline verified button diagnostic is distinct from an engine-accepted bid.

Tag LEDs remain static dim green while switched ON. Gateway outcome LEDs follow the same envelope as the buzzer. The original startup melody is retained; BID3 is below the spinning Ethereum mark on startup. The radar page has no BID3 footer and retains its complete dotted ring. Established sessions avoid per-press reconnect/proof polling. Cold discovery and end-to-end latency are not zero or hardware-verified here.

[INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md) connects the canonical bridge to the existing engine. Use enrolled seat public keys, INTENT_SIGNATURES_REQUIRED=1 and **countdownMs=10000** on each new auction. [integration/auction-template.json](integration/auction-template.json) contains the actual public keys and 10-second rules. Existing frozen rules are not silently rewritten.

The engine serializes same-quote presses: first valid bid accepted, the other STALE. Accepted bids restart the timer; the accepted leader can win after intentionally switching OFF. A tag-specific fault blocks only that bidder; infrastructure failure pauses the room. Tag recovery requires a fresh JOIN and does not reset the live countdown. Arkiv remains outside the live bid loop. See [BIDDING_RULES.md](BIDDING_RULES.md) and [FAST_PROTOCOL.md](FAST_PROTOCOL.md).

**Engine v1 constraint:** signatures bind a tag's session, sequence and quote version, but not auctionId/epoch. Operate one active lot and drain outstanding work before switching lots. This update does not claim cross-round replay protection, parallel-room routing or payment settlement.

## Validate and build

From firmware/ with Python 3.10+ and Clang installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python tools/check.py
PYTHONPATH=../engine .venv/bin/python -m pytest ../engine/tests -q
python3 tools/build.py --arduino-cli /absolute/path/to/arduino-cli
```

Install the pinned ESP32 core before compiling:

```sh
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.3.12 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

The checksum check also validates canonical shared-header copies. It runs twelve C++ programs with sanitizers, firmware Python checks against the real engine canonical message/state machine, and the bridge's PTY/ACK tests. Temporary executables remain outside the source tree. After intentional source changes regenerate SHA256SUMS.json with `python tools/check.py --update-checksums`, then rerun checks. CI runs the same checks, engine tests and all three board builds.

[VALIDATION.md](VALIDATION.md) records the delivered code's target builds and host verification. Real RF, acoustic/LED timing, heap margin and a complete assembled-hardware round remain bench acceptance work. [previews/off-and-lost.png](previews/off-and-lost.png) shows the V6 availability states; [previews/gateway-screens.png](previews/gateway-screens.png) shows the retained input/result screens. Both are rendered from the actual OLED drawing code. [legacy_docs/](legacy_docs/) records the working baseline's provenance; V2, V4 and V5 remain in Git history. Archives, build products and raw local logs are excluded from Git. Font attribution is in [FONT_LICENSE.txt](FONT_LICENSE.txt).
