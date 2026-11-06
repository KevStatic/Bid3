# Tag 01 + Tag 02 + gateway — D2 push button firmware

Prepared 6 November 2026. Complete Arduino sketches are in `Tag01/`, `Tag02/` and `Gateway/`.

## What this update does

Connect a momentary push button between **D2 and GND on each XIAO ESP32-C3**. D2 is **GPIO4**, not GPIO2. Firmware enables the internal pull-up: released = HIGH, pressed = LOW. No extra pull-up resistor is needed for this short local button connection.

The tag debounces the input for 30 ms, counts once per stable press, and includes count/held state in a cryptographically signed response. A held button counts once. A short tap remains recorded in the count after release. Sampling runs in its own FreeRTOS task so normal signing/I2C activity does not rely solely on the main loop checking the pin.

The gateway verifies the enrolled identity and signed response, shows `BUTTON VERIFIED / TAG01 / PRESSES ...` on OLED and prints a button event over Serial. Each tag has its own counter. Existing dim LEDs, MPU readings, slide switch, OLED and audio behavior remain available.

**A press reports a button event. It does not automatically toggle auction participation or implement the auction engine.** No backend, dashboard deployment, Arkiv publication, five-second winner timer or signed auction JOIN/LEAVE is added by this package.

## Keep your original wiring

New connection on BOTH tags:

| Button connection | XIAO pin |
|---|---|
| One button terminal | D2 / GPIO4 |
| Other button terminal | GND |

Do not connect this button to 3V3 or 5V. For a four-leg tactile switch, use terminals that are open when released and connected only when pressed; two legs on the same permanently connected side will read held continuously.

Keep the separate slide switch: COM→GND, ON terminal→D1/GPIO3. The slide switch must be ON for BLE/button reporting. OFF enters deep-sleep standby; the new D2 button does not wake the tag from that standby. Protected battery remains directly on rear BAT+/BAT−; USB-C charging remains available. MPU VCC remains on 3V3; SDA D4/GPIO6, SCL D5/GPIO7; LED D3/GPIO5 through 330 ohms. MPU's hardwired power LED can remain lit in standby.

Gateway wiring stays: OLED SDA21/SCL22; green LED25 and red LED26 through separate 330 ohm resistors; buzzer IO27; shared GND; slide switch supplies OLED/compatible buzzer from 3V3. No GPIO33, no gateway battery. Gateway BLE operates whenever USB powers the ESP32; the peripheral switch does not disconnect the MCU.

## Upload in Arduino IDE

1. Extract the entire ZIP. Keep every `.h` file next to its `.ino`; do not upload only the tiny wrapper without its headers.
2. Use **esp32 by Espressif Systems, version 3.3.12**, the version used for compilation here. These sketches use its built-in BLE, crypto, Wire and Preferences libraries; no external sensor/OLED library is required.
3. Keep **Erase All Flash Before Sketch Upload = Disabled** to preserve enrolled private keys. Do not swap Tag01 and Tag02 sketches between physical tags.
4. Open **`Tag01/Tag01.ino`**, select **XIAO_ESP32C3**, select Tag 1's USB port, set its slide switch ON, and upload.
5. Open **`Tag02/Tag02.ino`**, select **XIAO_ESP32C3**, select Tag 2's USB port, and upload.
6. Open **`Gateway/Gateway.ino`**, select **ESP32 Dev Module**, select the gateway's USB serial port, and upload.
7. Use the default application partition. All three fit the default 1,310,720-byte application limit. Default framework/board USB settings are appropriate; the two XIAOs and WROOM gateway are different boards.
8. Open gateway Serial Monitor at **115200 baud**, with its display/buzzer switch ON. Turn both tag slide switches ON and wait until each prints `BUTTON SYNC` / verified state before pressing.
9. Press and release Tag 1's button, then Tag 2's. Check tag number and count in the gateway output and OLED.

If a USB port disappears while the tag is asleep, turn the slide switch ON. For recovery use the XIAO's BOOT/reset procedure. Do not erase all flash as a routine fix; a new identity requires deliberate re-enrollment.

## Expected output

Examples below are illustrative, not captured live hardware measurements:

```text
TAG01 BUTTON SYNC | count_since_wake=0 | held=NO | baseline; not a new live press
TAG02 BUTTON SYNC | count_since_wake=0 | held=NO | baseline; not a new live press
TAG01 BUTTON PRESSED | +1 | total=1 | held=NO
TAG02 BUTTON PRESSED | +1 | total=1 | held=YES
```

`held=NO` after a fast tap is expected: the counter records the press even if it was released before the gateway's next signed check.

- `BUTTON_STATE_JSON=` carries the full signed button/gateway envelope every successful check.
- `BUTTON_EVENT_JSON=` reports a detected counter advance and references that signed state by digest. Verify the canonical state and derive deltas; do not treat the unsigned JSON summary as its own signature.
- `BUTTON_LOCAL` in a tag's Serial Monitor confirms the physical input locally.
- Counts are per wake/boot; they reset after tag reset or slide-switch sleep/wake. A new boot is explicitly synchronized as a baseline rather than generating false live presses.
- First synchronization reports the existing count but deliberately does not turn historical presses into new live events. Wait for initial synchronization before a live press demonstration.
- Multiple presses between gateway checks appear as `+N`, not fabricated individually timestamped presses.
- Reconnecting the same still-awake tag retains its counter. A restarted gateway establishes a new baseline and does not replay historical presses as new bids.

The gateway polls authenticated snapshots, normally attempting a renewal about two seconds after a completed transaction for that tag. Two tags share the radio and cryptographic work, so delivery can take several seconds and longer during retries. This is not an immediate interrupt forwarded over radio and has no measured maximum latency. Do not use these delays as proof of five-second-auction fairness. Press history is not guaranteed to survive power loss, slide-switch sleep or a reset before it was observed.

The level is a sampled signed snapshot, not a continuous held-button stream. A minimum 30 ms stable press/release is intentional debounce. BLE disconnects, tag OFF and radio silence are not explicit auction withdrawal events.

## OLED/buzzer troubleshooting

At 115200 send `d` to switch SH1106/SSD1306 driver if the OLED is blank, `s` for status, `p` for public gateway enrollment, `b` for startup sound, `m` for passive/active buzzer mode and `i` for active-module trigger polarity. Existing saved settings are retained. A fixed-pitch active buzzer can play rhythms, not arbitrary pitches. Use the actual module's compatible supply/logic rating.

Both tags must use this new firmware for button proof responses. Old tags can still advertise, but cannot answer the new `BTB1` request. The updated tags also retain the original `BTQ1`/190-byte proof response for legacy readers.

If the gateway reports enrollment mismatch, compare the public enrollment lines before changing anything. Its two pinned keys/device IDs are the same corrected keys previously supplied by the user; no private keys are included in source. A tag NVS number mismatch refuses silent replacement.

## Verification and limits

See `VALIDATION.md`. Both tag sketches and the gateway were compiled; host debounce/packet/security/render tests were run. No physical button, RF link, actual OLED or acoustic test was performed by the assistant. No devices were flashed by this packaging task.

Source pin reference: [Seeed XIAO ESP32-C3 pin map](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/#pin-map).
