# Bid3 V5 Live Input — validation

6 November 2026. No board was flashed and no physical RF, acoustic or button-to-pixel measurement was performed by the assistant.

## Target builds

All three sketches compiled successfully with the Arduino IDE bundled CLI 1.5.1, Espressif ESP32 core 3.3.12 and default application partitions.

| Sketch | FQBN | Application bytes / limit | Static globals / RAM |
|---|---|---:|---:|
| Gateway | esp32:esp32:esp32 | 1219122 / 1310720 | 47156 / 327680 |
| Tag01 | esp32:esp32:XIAO_ESP32C3 | 713935 / 1310720 | 20036 / 327680 |
| Tag02 | esp32:esp32:XIAO_ESP32C3 | 713939 / 1310720 | 20036 / 327680 |

Static usage excludes dynamic BLE/crypto allocations and task stacks; physical heap/stack margin remains a bench check. Delivered source headers were compared with their compiled copies, ignoring Arduino's injected line directives.

## Host checks

- Eleven C++ programs passed with C++17, warnings as errors, AddressSanitizer and UndefinedBehaviorSanitizer.
- New live-input checks: 1,860 checks of packet fields, nonce/boot/tag context, replay/counter windows, session resets, press/release state, two tags, stale work and the actual BUTTON PRESSED renderer. The test also includes Arduino's INPUT macro before the wire header.
- OLED driver: 78 checks, including urgent frame replacement in the middle of an animation transfer, page0 restart with the new snapshot, initial visibility, switched-power settling and bus recovery.
- Existing regressions passed: 274 debounce/tracker/wire checks; 103 legacy wire checks; 50,030 runtime checks; 68 audio sequence checks; 38 mocked sound GPIO checks; 1,164 renderer frames; 9,216 radar/startup checks; 50 canonical fast-frame checks; 1,596 LED/sound-envelope checks.
- 23 firmware Python tests and 2 bridge Python tests passed. These cover supplied public pins, unchanged cryptographic helpers, HKDF agreement, canonical signatures matching the actual engine, signature tampering, serial short-line delivery, session ACK correlation, same-quote contention, full 10-second reset and a leader remaining bound after OFF.
- Actual engine suite: 31 passed. Arkiv schema drift check: schemas match. Engine, bridge and web runtime files are unchanged by V5.

## What changed for latency

The button sampler sends the 80-byte session-HMAC receipt directly after debounce. It does not wait for main-loop ECDSA, pending JOIN/BID acknowledgements or sensor work. A dedicated gateway input task verifies session context/MAC before queueing UI; heavyweight gateway ECDSA now runs on the other CPU core. Urgent input frames bypass the animation frame timer and replace a pending OLED snapshot. Release updates cannot erase an accepted/refused outcome; an 80 ms minimum input overlay ensures the initial receipt is visible even if an engine result arrives quickly.

Without a fresh engine state, JOIN/LEAVE is locally acknowledged RECEIVED, never ACCEPTED. This avoids the old 3-second reconnect cycle while retaining the admission requirement for price bids. Diagnostic button presses do not need individual ECDSA signatures; actual BID intents still do. Advertising requests 50–75 ms; established BLE requests 7.5–15 ms with zero peripheral latency. Missing-sensor retry configuration is deferred while connected.

These are implementation changes and host checks, not a measured physical latency guarantee. The existing 30 ms stable debounce is intentional. RF contention, actual negotiated BLE intervals, I2C transfer and panel refresh remain nonzero. Measure the assembled hardware before reporting an end-to-end bound.

## Preservation and compatibility

Original advertisement format, identity/proof service, enrollment pins and NVS namespaces remain. Tag LEDs stay static; original startup melody and complete radar ring remain. Original working archive SHA256 is recorded in legacy_docs/README.md. Nine unchanged baseline security/wire/button/output helper hashes still match. Oled.h intentionally adds urgent frame replacement, so its original baseline hash is retained only for provenance; its behavior is checked by the expanded OLED regression.

All three boards need matching V5 sketches for the input receipt. V4 bridge compatibility is preserved by retaining build=V4_WORKING_BASE in the status contract and adding firmware=V5_LIVE_INPUT. No backend migration is required for the new OLED feature. Existing engine v1 signatures remain limited to one active lot with pending work drained before changing lots; they do not supply cross-round replay protection.

Run `python tools/check.py` with firmware/requirements-dev.txt installed. Engine-dependent host cases require the actual sibling engine/ or BID3_ENGINE_PATH; standalone archives skip those cases when it is absent. Physical acceptance remains: both buttons, simultaneous presses, held/released display, repeated offline use without reconnects, actual signed bidding, OFF/ON, link-loss recovery and real OLED/light/buzzer timing.
