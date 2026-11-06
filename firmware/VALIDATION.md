# Bid3 V4 validation — 6 November 2026

These are checks actually run against this package. No device was flashed, and no physical BLE, button-to-light, acoustic or internet latency measurement was made.

## Target compilation

Arduino CLI bundled with Arduino IDE, installed Espressif ESP32 core **3.3.12**, default application partition, default board build settings. All three builds exited successfully.

| Sketch | FQBN | Application bytes / limit | Static globals / RAM |
|---|---|---:|---:|
| Gateway | esp32:esp32:esp32 | 1217394 / 1310720 (92%) | 47100 / 327680 |
| Tag01 | esp32:esp32:XIAO_ESP32C3 | 713429 / 1310720 (54%) | 19876 / 327680 |
| Tag02 | esp32:esp32:XIAO_ESP32C3 | 713433 / 1310720 (54%) | 19876 / 327680 |

The tag target uses the installed core's bundled NimBLE implementation; the WROOM gateway uses bundled Bluedroid. The additional notification/control characteristics fit the service's handle allocation. The original discovery code, advertisements and original four characteristic UUIDs are retained. Static figures exclude dynamic BLE allocations, mbedTLS allocations and task stacks. Actual heap margin must be observed on the boards.

## Host verification

All ten C++ executables compiled with C++17, warnings as errors, AddressSanitizer and UndefinedBehaviorSanitizer. They passed without reported violations:

- 274 debounce, button tracker and wire checks.
- 103 inherited tag-wire checks.
- 50,030 runtime policy checks.
- 68 original audio sequence checks; the startup melody array is byte-for-byte unchanged.
- 38 GPIO sound driver checks and 60 OLED power/recovery checks using mocks.
- 1,164 actual OLED renderer frames, including maximum counters and invalid UI tag indexes.
- 9,216 radar/startup checks, including all 64 outer-ring dots across 100 sweep frames and startup BID3 placement.
- 50 fast-frame/canonical-message checks.
- 1,596 checks of the actual LED/sound envelope policy for accepted, refused and sold signals, including silent gaps.

**25 Python tests passed.** These include the original enrolled-proof/signature/replay suites; HKDF/ECDH agreement against standard host implementations; supplied public-key pins; canonical C++ intent text matching the actual engine parser; a synthetic signed bid accepted by the engine signature verifier and rejected after quote mutation; real pyserial reads through an OS pseudo-terminal; exact acknowledgement session echo; simultaneous stale bids; full 10-second timeout; countdown restart; and an intentionally switched-off leader still winning.

The PTY serial test removes the previous read(256)/500ms batching delay. Its latest run recorded a maximum short-line delivery time of 0.367 ms over 12 host-only samples. **That is not BLE, button, internet or end-to-end bid latency.** It cannot support a claim of zero latency on the real system.

The actual team engine test suite also passed: **31 tests**. Tests used the local repository revision `37b74d52b1907381acb61762af3578fbd6fac8b7`. The matching bridge now lives at ../bridge/bid3_bridge.py; no engine/web runtime code is changed.

## Baseline provenance

The original working archive is identified in legacy_docs/README.md; its unchanged helper hashes are recorded in legacy_docs/BASELINE_SHA256.json. Binary archives are excluded from Git.

SHA256: `b3066a2419b366fd2e4845b853a2d3da60a310938ee3ed96217860ca4e649866`.

The following files were compared byte-for-byte against that ZIP and are unchanged:

- Gateway/Crypto.h
- Gateway/TagWire.h
- Gateway/ButtonWire.h
- Gateway/ButtonSecurity.h
- Gateway/ButtonTracker.h
- Gateway/RuntimePolicy.h
- Gateway/Oled.h
- Gateway/SoundOutput.h
- Gateway/VerifierSelfTest.h
- shared/ButtonInput.h

Both tag folders contain identical shared implementation headers, with the correct distinct tag-number wrappers. The three copies of the common fast wire/crypto/config headers match. The original stored NVS identity namespaces and the supplied public enrollments are retained. Git history records the V2-to-V4 changes; the new Fast*.h files contain the extension.

## Reproduce

Python host prerequisites: cryptography, ecdsa, pyserial, websockets; C++17 compiler. These are test/bridge dependencies, not extra Arduino libraries.

```sh
python3 tools/check.py
```

Engine integration tests additionally need the actual team engine package. They use the sibling engine/ by default, or set BID3_ENGINE_PATH to that directory. A standalone package skips those engine-dependent tests. Full engine checks were run separately with pytest. Renderer previews are under previews/. Raw local build/test logs are excluded from Git.

## Remaining physical validation

Upload all matching sketches and observe both original verified proofs and FAST_READY states. Check both buttons, tag OFF/ON and re-entry, RF loss pause/recovery, gateway/bridge power loss, simultaneous same-quote presses, countdown restart, ten-second sale and OFF leader eligibility. Measure edge_to_tag_ack_ms on the tags and observe the actual LED/buzzer edges. Cold discovery and cryptographic setup remain slower than the established-session path. Compilation, host signatures and simulated GPIO cannot establish RF reliability, timing bounds, battery behavior or acoustic synchronization on the assembled hardware.

The existing engine v1 intent signature does not bind a round identifier. The integration brief documents its one-active-lot/drain-before-switching constraint; cryptographic cross-round replay protection and parallel-room operation remain outside this release. Backend tokens, deployment, actual listing creation and Arkiv publication are not performed by this firmware task.
