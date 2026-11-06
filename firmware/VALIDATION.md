# Bid3 V6 reconnect feedback patch — validation

6 November 2026. No board was flashed and no physical RF, switch-to-pixel or acoustic measurement was performed by the assistant.

## Successful target builds

Arduino CLI 1.5.1, Espressif ESP32 core 3.3.12, default partitions. Both tags use XIAO_ESP32C3 and the gateway uses ESP32 Dev Module.

| Sketch | Application bytes / limit | Static globals / RAM |
|---|---:|---:|
| Gateway | 1220990 / 1310720 | 47220 / 327680 |
| Tag01 | 714145 / 1310720 | 20044 / 327680 |
| Tag02 | 714149 / 1310720 | 20044 / 327680 |

Static usage excludes BLE/crypto allocations and task stacks. Runtime margin remains a physical check. All three complete sketch folders were built from the delivered source; their source hashes match the packaged copies. Two existing GatewayApp snprintf range warnings remain in the board build (LINK/AUTH labels with an int tag index); neither is introduced by the feedback change. No build errors occurred.

## Verification

- Thirteen C++ programs passed with C++17, warnings as errors, AddressSanitizer and UndefinedBehaviorSanitizer.
- New reconnect feedback program: 20,061 checks. With repeated LOST application, 100 advertisements in 10 seconds produce one finite arrival cue (145 ms audible), not repeated chirps; repeated proof negotiation is also deduplicated. Tests cover independent tags, genuine return cooldowns and millis wrap, stale queued cues after loss/recovery, cancellation of current and queued cosmetic cues, preservation of startup/engine outcomes/other-tag feedback, and mocked passive/active buzzer silence with the idle LED policy restored.
- New OFF/LOST program: 981 checks of heartbeat context/flags, tag-uptime order including wrap, delayed JOIN versus newer OFF, both-tag availability, immediate proof-freshness override, OFF/LOST overlays, blocked OFF inputs and healthy-tag input operation; it also exercises 2000 renderer frames.
- Existing V5 button, radio-wire, signed-frame, input-replay, display, radar, sound and LED-envelope checks all pass unchanged.
- 23 firmware Python tests and 2 bridge Python tests pass, including canonical signature compatibility and the accepted leader staying bound after OFF.
- Matching current engine suite: 44 tests pass, including isolated tag loss, refusal of unavailable bidders, continued healthy bidding, admission on recovery, unchanged deadline on tag recovery, accepted unavailable leader eligibility and no fabricated winner without accepted bids. Infrastructure-wide pause/restart and current main's deployment/new-lot tests remain. One dependency deprecation warning was emitted by Starlette's httpx test client.
- No engine, web, bridge runtime or Arkiv schema change is included in this reconnect patch. No wire contract changed; the prior schema drift result remains applicable.

All Tag01, Tag02 and canonical shared tag sources are byte-identical to V6 TAG_OFF_FIX. The gateway patch changes only FastFeedback.h, FastGateway.h, GatewayApp.h and Sounds.h; the note arrays are unchanged. SoundOutput.h, Oled.h, Config.h, Crypto.h, FastCrypto.h and the fastInputReceipt path are unchanged. Pricing and the signature/canonical-wire format are unchanged. A patched gateway reports V6_RECONNECT_FEEDBACK_FIX automatically at 115200 baud.

## Agreed behavior

Intentional OFF sends authenticated switch state immediately after the existing 50 ms switch debounce, marks that tag OFF and removes its radar presence. It blocks new bids and discards unsent work from before OFF, including rapid OFF/ON cycles. A late old JOIN cannot overwrite a newer OFF observation. Signed LEAVE still reaches the authoritative engine.

A lost connection or missing established-session heartbeat marks only that tag LOST after the existing 1500 ms liveness threshold. It does not retain the legacy 25-second proof availability. The matching engine policy marks that seat UNKNOWN and blocks its new bids while healthy bidders and the running countdown continue. LINK OK alone is insufficient: a fresh JOIN is required. Tag recovery never resets that live deadline. Global bridge/gateway/engine outages retain the existing whole-room pause/recovery policy.

Already accepted bids remain binding after OFF or a tag fault and can still win. In-flight bids use the engine's recorded decision; the firmware does not erase a committed bid or invent a new bid on recovery. No accepted bid means no automatic winner.

## Run checks and deploy

Run tools/check.py with the host test dependencies installed. Engine-dependent checks use the sibling engine directory or BID3_ENGINE_PATH. Standalone archives skip those cases unless the actual engine is supplied.

The package includes all three V6 sketches. If the tags already run V6 TAG_OFF_FIX, upload only Gateway; no tag, engine or bridge update is required for this audio patch. Otherwise follow START_HERE for the complete V6 setup. Use 115200 baud and preserve NVS with Erase All Flash disabled. The previously required V6 engine policy remains necessary for fault isolation; older engines still pause the room on tag loss. The standalone archive also includes the original V6 engine patch for older checkouts. Publishing the source does not deploy the cloud engine or flash a device.

Physical acceptance remains: both tags OFF separately and together, OFF/ON while a bid is queued/signing, loss of one tag while the other bids, fresh admission after reconnect, countdown continuity, accepted OFF/LOST leader eligibility and gateway-wide failure pause. Software checks do not establish a physical latency bound.

Also verify repeated reconnect advertisements cause no repeated discovery chirps/green sound pulses, including standalone/LOBBY/PAUSED operation. A healthy remaining tag retains the original idle green breathing indication. Startup and actual engine outcomes can still legitimately sound. See CHANGES_V6_RECONNECT_FIX.md for the short hardware check.
