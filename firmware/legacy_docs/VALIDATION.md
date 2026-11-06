# D2 button firmware — validation

Date: 6 November 2026. This report describes checks actually performed for this package.

## Actual target compilation

Arduino CLI bundled with Arduino IDE; installed Arduino ESP32 core **3.3.12**; default application partition. No device upload was performed.

| Sketch | FQBN | Program storage | Global variables |
|---|---|---:|---:|
| Tag01 | `esp32:esp32:XIAO_ESP32C3` | 701441 / 1310720 bytes (53%) | 19428 / 327680 bytes (5%) |
| Tag02 | `esp32:esp32:XIAO_ESP32C3` | 701441 / 1310720 bytes (53%) | 19428 / 327680 bytes (5%) |
| Gateway | `esp32:esp32:esp32` | 1198250 / 1310720 bytes (91%) | 46220 / 327680 bytes (14%) |

New tag sampler task, BLE allocations and gateway workers also consume runtime heap/stacks. Static memory figures are not a measured runtime safety margin. Gateway `s` reports actual free heap when run on hardware.

## Host checks executed

- **274 C++ checks** against actual `ButtonInput.h`, `ButtonTracker.h`, `ButtonWire.h` and inherited `TagWire.h`: switch bounce, stable press/release, no repeat while held, ignored short pulse, timer wrap, duplicate/nonincreasing sequence, count rollback, new-boot baseline, aggregated count delta, malformed frames, mismatched request context and timeout.
- That C++ executable ran with AddressSanitizer and UndefinedBehaviorSanitizer and warnings as errors; no reported violations.
- **15 Python tests passed**: nine new button/enrollment tests plus the six inherited legacy gateway security tests. New tests cover all 273 gateway-body byte mutations, every appended button byte changed inside a freshly re-signed gateway envelope, both signatures, wrong signature domain, low-S bounds, nonce replay/expiry, bad signature not consuming nonce and original enrolled fingerprints/device IDs.
- **1164 actual OLED renderer frames** exercised the new button overlay, each tag, malformed UI tag indexes, maximum counter values and existing drawing paths under the same sanitizers; no reported violations.
- Three copies of `BagTrailTag.h` and `ButtonInput.h` are byte-identical. Both sketch wrappers retain the correct tag number.
- Existing gateway `Crypto.h`, `TagWire.h`, `RuntimePolicy.h`, `Oled.h`, `Sounds.h`, `SoundOutput.h` and `VerifierSelfTest.h` are byte-identical to the delivered V3 files. The new protocol uses a separate domain and helper, not relaxed legacy signature checks.
- Trusted real public enrollments and original tag/gateway NVS identities remain unchanged. No private device keys are included.
- Source package hashes, ZIP integrity and extracted sketch/header presence are checked during packaging.

## Run host checks

Requires Python `cryptography` and a C++17 compiler; these are host tools, not Arduino libraries.

```sh
python3 -m unittest discover -s tools -p 'test*py' -v
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_button.cpp -o /tmp/bagtrail-button-check
/tmp/bagtrail-button-check
clang++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tools/test_button_visuals.cpp -o /tmp/bagtrail-button-visuals
/tmp/bagtrail-button-visuals
```

## Limits

No physical D2 button, solder connection, actual radio exchange, OLED panel, buzzer, sleep current or end-to-end latency was tested by the assistant. The user still needs to upload and observe the assembled devices. Compilation and host tests cannot establish those properties.

This is a signed snapshot/counter detection release, not auction JOIN/LEAVE, a continuous held-button input stream or deadline-safe admission. First/new-boot synchronization establishes a baseline. Delivery may be delayed; several presses may be aggregated; unobserved counts are lost on tag sleep/reset/power loss. Backend replay persistence, server-issued challenges, Arkiv, a deployed dashboard and five-second auction closing are not implemented here.
