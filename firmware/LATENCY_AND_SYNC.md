# Latency and synchronized feedback

## Implemented changes

The old path waited for reconnect, service discovery, challenge signing, response reads, gateway countersigning and a two-second poll renewal. The new path keeps two GATT sessions, subscribes to event notifications, debounces input on a dedicated1 ms task, sends each signed intent immediately and uses session HMAC for rapid controls/liveness. Connection setup and ECDH occur on session establishment, not every button press.

The requested connection interval is7.5–15 ms with zero peripheral latency. It is a request; the stack/radio must actually negotiate and sustain it. Two links share the gateway radio. No Wi-Fi is added to the gateway. The laptop bridge owns internet transport.

Gateway UART is 460800 baud. A 600-byte event takes approximately 13 ms on an 8-N-1 UART at that rate, versus 52 ms at 115200, before buffering/USB scheduling. The USB adapter and bridge must sustain the selected rate. Do not interpret baud rate as an end-to-end latency measurement.

A separate Serial task reads engine acknowledgements without waiting for OLED pages. The dedicated feedback task runs independently of OLED, BLE connection setup, signature verification and publication. GPIO25/26 use LEDC group 0, while the passive buzzer uses channel 8/group 1, preventing tone-frequency changes from changing LED PWM. When the switched peripheral supply is unavailable, buzzer GPIO is made high-impedance; active-low modules are not driven HIGH into an unpowered peripheral.

## What is synchronized

On an engine acceptance/refusal, one feedback event starts one elapsed-time schedule. Accepted: green and2349 Hz envelope together for 65 ms. Refused: red and880 Hz together for three 40 ms pulses at 80 ms spacing. Sale: three green/tone pulses. An active fixed-tone module uses the same pulse envelope. The sound carrier has its own period; synchronization refers to light/tone onset and envelope, not matching a LED's brightness to an acoustic pressure waveform.

Tag feedback begins after it receives the authenticated decision. Tag and gateway are independent devices; their onsets are separated by transport and scheduling. No perfect cross-device simultaneity is claimed. Physical light/tone onset also depends on the LED circuit and buzzer module. Gateway firmware schedules outputs from a shared clock; measure physical skew rather than asserting it is zero.

## Remaining latency terms

`edge sampling +12 ms debounce + queue + tag ECDSA signing + BLE delivery + gateway ECDSA verification + UART/USB + bridge/engine commit round-trip + command delivery + feedback scheduling`.

Signing and verification are retained so a gateway cannot turn an unauthenticated press into an independently signed bid. The tag logs `BID3_SIGN_US`; gateway intents include `verify_us` and receive diagnostics. These are useful stage measurements, not total latency. Heavy crypto runs outside Bluetooth callbacks. No Arkiv RPC is awaited in this path.

A tag signs its locally offered quote at the initial down edge. This prevents re-pricing during debounce/signing/transit. It does **not** prove which price a human actually saw on a phone/projector. If strict screen-visible-offer acknowledgement is required, the engine must coordinate display readiness before distributing a quote to tags; the supplied frontend was not available to implement that additional handshake.

## Hardware acceptance run

Use the actual two tags, gateway, USB bridge and hosted engine. Record firmware hashes, core version, buzzer type, negotiated link settings and transport. Run at least 1000 accepted/refused interactions across alternating and simultaneous button presses. Report p50/p95/p99/max and loss/timeout counts rather than one favorable sample.

Measure physical button→gateway LED, button→tone and LED↔tone onset with a logic analyzer or synchronized capture. Record high-level bid signature/verification/engine commit timestamps separately. Repeat with OLED animation, absent OLED, interference, reconnection, poor USB/cloud latency, a held button and rapid bounce.

An initial engineering target is under 150 ms p95 for button→gateway decision feedback on a local engine and under 2 ms gateway LED↔buzzer-envelope skew. These are **unverified targets**, not claims; software ECDSA and the actual board/host may exceed them. Hosted latency adds the measured internet round-trip. If measurements fail a target, profile the recorded stages and adjust the architecture explicitly rather than removing authentication or declaring success.

Technical references: [Espressif GAP callback guidance](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_gap_ble.html), [LEDC timer/channel independence](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html). The installed Arduino ESP32 core 3.3.12 source was checked for the actual BLE APIs used.

## V2 connection and startup corrections

Physical BLE link discovery runs before engine ARM. A compact primary-advertisement marker removes the same-packet name/service assumption. The gateway waits for the negotiated MTU callback, refreshes services after reconnect, and logs transport separately from cryptographic/auction readiness. Missing idle engine ARM does not make the gateway refuse a physical connection.

The supplied original startup score is restored when the switched OLED/buzzer peripherals become ready. It runs nonblocking on the feedback task and yields to an actual bid outcome. The tag LEDs are now static switch indicators; all tag blink/leading/refusal animations have been removed.
