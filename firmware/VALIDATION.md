# Bid3 V6 OFF/LOST fix — validation

6 November 2026. No board was flashed and no physical RF, switch-to-pixel or acoustic measurement was performed by the assistant.

## Successful target builds

Arduino CLI 1.5.1, Espressif ESP32 core 3.3.12, default partitions. Both tags use XIAO_ESP32C3 and the gateway uses ESP32 Dev Module.

| Sketch | Application bytes / limit | Static globals / RAM |
|---|---:|---:|
| Gateway | 1220478 / 1310720 | 47188 / 327680 |
| Tag01 | 714145 / 1310720 | 20044 / 327680 |
| Tag02 | 714149 / 1310720 | 20044 / 327680 |

Static usage excludes BLE/crypto allocations and task stacks. Runtime margin remains a physical check. All 31 delivered sketch headers were compared with the successfully compiled copies, ignoring Arduino's injected line directive.

## Verification

- Twelve C++ programs passed with C++17, warnings as errors, AddressSanitizer and UndefinedBehaviorSanitizer.
- New OFF/LOST program: 981 checks of heartbeat context/flags, tag-uptime order including wrap, delayed JOIN versus newer OFF, both-tag availability, immediate proof-freshness override, OFF/LOST overlays, blocked OFF inputs and healthy-tag input operation; it also exercises 2000 renderer frames.
- Existing V5 button, radio-wire, signed-frame, input-replay, display, radar, sound and LED-envelope checks all pass unchanged.
- 23 firmware Python tests and 2 bridge Python tests pass, including canonical signature compatibility and the accepted leader staying bound after OFF.
- Matching engine suite: 36 tests pass. New cases cover isolated tag loss, refusal of unavailable bidders, continued healthy bidding, admission on recovery, unchanged deadline on tag recovery, accepted unavailable leader eligibility and no fabricated winner without accepted bids. Infrastructure-wide pause and restart tests remain.
- Arkiv schema drift check reports schemas match. No web or bridge runtime or Arkiv schema change is included.

The V5 fastInputReceipt function is byte-identical. Twelve core input, sound, OLED, feedback, crypto, enrollment and wire helper files are byte-identical to V5, including Sounds.h, SoundOutput.h, Oled.h, Config.h, Crypto.h, FastCrypto.h and ButtonInput.h. Pricing and the signature/canonical-wire format are unchanged.

## Agreed behavior

Intentional OFF sends authenticated switch state immediately after the existing 50 ms switch debounce, marks that tag OFF and removes its radar presence. It blocks new bids and discards unsent work from before OFF, including rapid OFF/ON cycles. A late old JOIN cannot overwrite a newer OFF observation. Signed LEAVE still reaches the authoritative engine.

A lost connection or missing established-session heartbeat marks only that tag LOST after the existing 1500 ms liveness threshold. It does not retain the legacy 25-second proof availability. The matching engine policy marks that seat UNKNOWN and blocks its new bids while healthy bidders and the running countdown continue. LINK OK alone is insufficient: a fresh JOIN is required. Tag recovery never resets that live deadline. Global bridge/gateway/engine outages retain the existing whole-room pause/recovery policy.

Already accepted bids remain binding after OFF or a tag fault and can still win. In-flight bids use the engine's recorded decision; the firmware does not erase a committed bid or invent a new bid on recovery. No accepted bid means no automatic winner.

## Run checks and deploy

Run tools/check.py with the host test dependencies installed. Engine-dependent checks use the sibling engine directory or BID3_ENGINE_PATH. Standalone archives skip those cases unless the actual engine is supplied.

Upload all three V6 sketches, use 115200 baud and preserve NVS with Erase All Flash disabled. Deploy the matching engine/ code for the per-bidder fault policy; older engines still pause the room on tag loss. The standalone archive also includes a patch, replacement engine source and tests for older checkouts. Publishing the source does not deploy the cloud engine or flash a device.

Physical acceptance remains: both tags OFF separately and together, OFF/ON while a bid is queued/signing, loss of one tag while the other bids, fresh admission after reconnect, countdown continuity, accepted OFF/LOST leader eligibility and gateway-wide failure pause. Software checks do not establish a physical latency bound.
