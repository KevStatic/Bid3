# Bid3 V2 validation — 6 November 2026

Repository import validation was rerun on 6 November 2026 with Arduino CLI 1.5.1, installed Espressif Arduino ESP32 core 3.3.12 and default application partitions. All three sketches compiled with `--warnings all`; the final builds emitted no warnings. No physical tag/gateway was flashed or bench-tested during this import.

## Repository checks reproduced

- All **39 Python tests** passed, including the V2 policy/signature tests and retained legacy enrollment/signature regressions.
- All **10 C++ host programs** passed with `-Wall -Wextra -Werror`, AddressSanitizer, UndefinedBehaviorSanitizer and sanitizer recovery disabled: **83,111 checks/renderer frames** in total.
- All **17 shared-header copies** match their canonical sources. `tools/check.py` also verifies the complete firmware checksum manifest, including the build/check tooling and docs.
- The supplied folder and ZIP matched byte-for-byte before import. Runtime cleanup replaces `memset` on a C++ packet object with value initialization and adds explicit BLE2902 descriptors only for Bluedroid; NimBLE supplies its descriptor automatically. No enrollment key, device ID, NVS namespace or pin assignment was changed.
- `tools/build.py` enforces the pinned Arduino CLI/core versions and compiles in temporary directories. `.github/workflows/firmware.yml` runs the host checks and a three-target board build with action dependencies pinned to commit SHAs.
- The existing backend serial contract was inspected and its incompatibility with V2 is documented in [README.md](README.md). Bridge, engine, web and Arkiv implementation files are unchanged.

## Final target compilation

| Sketch | Board | Program storage /1,310,720 | Static variables |
|---|---|---:|---:|
| Tag01 |XIAO_ESP32C3 |694,813 bytes (53%) |20,580 bytes |
| Tag02 |XIAO_ESP32C3 |694,819 bytes (53%) |20,580 bytes |
| Gateway |ESP32 Dev Module |1,207,674 bytes (92%) |48,044 bytes |

These figures do not measure runtime heap, task stack margin or sustained two-link radio operation.

## Supplied V2 release checks and background

- All 24 Python policy/signature tests passed, retaining the 10-second hammer, stale simultaneous-bid rejection, binding bids after OFF, replay/idempotency, pricing and invalid-signature coverage.
- **20,031 discovery/connection/static-LED checks** passed against the actual shared ConnectionPolicy.h with warnings as errors and AddressSanitizer/UndefinedBehaviorSanitizer. They exercise primary manufacturer data without a name, name-only fallback, malformed discovery markers, both tag indexes, connection before ARM/trust provisioning and a static LED independent of auction timing.
- **2,127 input/wire/feedback checks** passed under the same sanitizers.
- **9,216 actual radar/startup pixel checks** passed: the radar header/footer contain no BID3 label, BID3 remains under the Ethereum startup mark, and all 64 outer-ring dots survive 100 animated frames. The old footer clear at y=57 was removed because it erased the circle's bottom edge.
- **68 original audio-player checks** passed. Gateway/Sounds.h is byte-identical to the original user-supplied package, including the startup notes and timing. The restored startup score runs nonblocking and is preempted by auction feedback.
- **1,164 actual OLED renderer frames** passed sanitizer checks. The final startup/radar/accepted/refused/result contact sheet was rendered and visually inspected.
- The supplied gateway public key was validated as a secp256k1 point and its SHA256 matched the owner's readout. It is pinned identically in both tag builds. The two original tag public keys/device IDs and tag-number wrappers are preserved.
- Canonical shared header copies and ZIP hashes were checked during packaging.

## Root causes addressed

1. The previous connection task required engine ARM before attempting a BLE link. V2 establishes and identifies both physical BLE links immediately; auction activation remains separately authorized.
2. Discovery required name and service UUID together. V2 primary advertisements include a compact per-tag marker and the receiver handles name-only/marker-only discovery hints before checking the pinned GATT identity.
3. The old flow read an optimistic MTU cache immediately after starting an asynchronous negotiation. V2 waits for the actual CFG_MTU event and validates the result.
4. GATT service handles could remain cached across reconnects in the installed library. V2 explicitly refreshes services after connecting.
5. The previous instructions incorrectly listed 115200 for gateway public-key enrollment even though the gateway used 460800. V2 documents 460800 for the application gateway and 115200 for tags/the separate readout helper. The app also prints its public key automatically before ARM, and p no longer requires a newline.
6. Both supplied tag logs showed missing gateway authority. The exact owner-supplied gateway public key is now included in both tag builds, so manual enrollment is unnecessary for that gateway.

## Reproduce checks

From the `firmware/` directory, the complete repeatable checks are:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python tools/check.py
python3 tools/build.py
```

See README.md for provisioning the pinned Arduino toolchain. The original
individual V2 test commands are retained below for targeted debugging:

```sh
python3 -m unittest discover -s tools -p 'test_bid3*.py' -v
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_bid3_connection.cpp -o /tmp/bid3-connection
/tmp/bid3-connection
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_bid3_wire.cpp -o /tmp/bid3-wire
/tmp/bid3-wire
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_bid3_radar.cpp -o /tmp/bid3-radar
/tmp/bid3-radar
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_audio.cpp -o /tmp/bid3-audio
/tmp/bid3-audio
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_button_visuals.cpp -o /tmp/bid3-visuals
/tmp/bid3-visuals
```

Python signature tests require cryptography. Hardware sketches use bundled Arduino libraries.

## Physical verification remaining

The user's identity readout confirms the gateway key, not successful operation of the newly compiled BLE firmware. Upload matching V2 sketches to all three boards, replacing the temporary identity-readout app on the gateway. Require DISCOVERED and CONNECTED for both tags before testing authenticated engine sessions. If a link is rejected, use the explicit reason rather than erasing flash or generating replacement keys.

Actual RF performance, physical sound/light onset, multi-link heap/stacks, USB reliability and end-to-end engine/Arkiv operation remain hardware/service acceptance work. The code changes and host checks do not justify claiming zero latency or bench-tested success. The team engine still owns bid decisions and the 10-second final result; no fallback fabricated auction was introduced.
