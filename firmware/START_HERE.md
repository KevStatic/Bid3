# Bid3 V5 — upload these three sketches

This is the corrected Gateway, Tag01 and Tag02 source package, rebuilt from the exact working ZIP you supplied. The original BLE advertisements, service, identity storage, discovery and signed button-proof exchange are the foundation. An authenticated persistent notification channel is enabled only after that original exchange succeeds.

## Upload

1. Extract this entire package. Keep each sketch folder and all its headers together.
2. In Arduino IDE use **esp32 by Espressif Systems 3.3.12**. No additional Arduino libraries are required.
3. Set **Erase All Flash Before Sketch Upload = Disabled**. Existing enrolled private identities must remain in NVS. Keep the default application partition.
4. Upload `Tag01/Tag01.ino` to physical Tag 1, selecting **XIAO_ESP32C3**. Turn its slide switch ON.
5. Upload `Tag02/Tag02.ino` to physical Tag 2, selecting **XIAO_ESP32C3**. Turn its slide switch ON.
6. Upload `Gateway/Gateway.ino` to the gateway, selecting **ESP32 Dev Module**.
7. **Serial baud is 115200 on all three boards.** Close Serial Monitor before starting the bridge, which needs exclusive access to the gateway USB port.

Discovery starts automatically when powered. No ESP RESET/BOOT button, `p` command, `GATEWAY_KEY` enrollment command, `BID3_ARM` command or GPIO33 connection is required for normal operation with your supplied identities. Firmware includes your two real tag public enrollments and pins your actual gateway public key. It never prints or replaces existing private keys silently.

## New button behavior

After FAST_READY, pressing either D2 button sends an immediate, session-authenticated input receipt to the OLED independently of bid signing and engine acknowledgements. You see **BUTTON PRESSED**, the tag number, press count and **DOWN/UP** state. This also works without the laptop bridge. The tag stays connected instead of repeatedly reconnecting on an unacknowledged offline JOIN. The input display can interrupt startup/animation frames.

The 30 ms switch debounce remains intentional. BLE transmission, scheduling and the OLED transfer still take time; zero milliseconds is not a physical guarantee. Bid verification/engine confirmation remains separate from the input receipt.

## What you should see

The gateway announces `Bid3 V5 WORKING_BASE`, then discovers the same `BagTrail-Tag01` and `BagTrail-Tag02` BLE devices as your working ZIP. The original signed checks produce `TAG01 BUTTON SYNC` / `TAG02 BUTTON SYNC`. Successful fast negotiation then prints:

```
BID3_LINK tag=TAG1 state=FAST_READY
BID3_LINK tag=TAG2 state=FAST_READY
```

`AUCTION_STATUS_JSON=` repeats automatically every 500 ms, including each tag's proof-seen and fast-ready flags. This lets you identify the loaded version without pressing a board button. Initial discovery/proof establishment still takes time; the faster path applies after the connection is established.

Without the engine/bridge, a verified physical press is a **BUTTON PRESSED / INPUT RECEIVED diagnostic**, not an accepted price bid. Real auction operation requires the included matching bridge and the authoritative engine; see `INTEGRATION_BRIEF.md`. In particular, use a new auction with **countdownMs = 10000**. Existing frozen auctions are not silently rewritten.

## Preserved hardware and display

- Tag BID button: **D2 / GPIO4 to GND**, INPUT_PULLUP, 30 ms stable debounce. A held button counts once. Keep the separate switch on **D1 / GPIO3 to GND**.
- Tag LED: **D3 / GPIO5**, static dim green while the switch is ON; OFF while switched OFF. It does not blink for bidding.
- Original MPU wiring remains SDA GPIO6 / SCL GPIO7. Missing sensor data does not block BLE identity detection.
- Gateway keeps OLED SDA21 / SCL22, green LED25, red LED26 and buzzer27. BLE runs from USB independently of the OLED power switch.
- Original startup melody is retained. Startup shows **BID3 below the spinning Ethereum mark**. The radar page has no BID3 footer and its complete outer dotted ring is preserved.
- Accepted bids use green plus the acceptance tone; refused bids use red plus the refusal tone. Both follow the same sound envelope, including its silent gaps. Closely spaced outcomes play in order. The engine acknowledgement determines acceptance.
- OFF sends a signed LEAVE while keeping the established radio available. The LED turns OFF; an already accepted leading bid remains binding. If no fast session exists, the original OFF/deep-sleep behavior remains.

## Diagnose without changing keys

| Observation | Meaning / next check |
|---|---|
| Gateway still prints old `BID3_HEALTH_JSON` at 460800 | An older build is running. Upload this package's `Gateway/Gateway.ino`; V5 is 115200 and has the V5 startup/status lines. |
| No `proof_seen` and no verified snapshot | Original discovery/authentication has not succeeded. Check matching uploads, tag slide switches, power and antennas. |
| `REJECTED_TAG=... enrollment_mismatch` | Device identity differs from the supplied public enrollment. Do not erase keys to bypass it. |
| Proof seen but no FAST_READY | Optional channel negotiation failed; signed snapshot diagnostics remain available. Check that both tag sketches are V5. |
| FAST_READY but no accepted BID | Confirm the included bridge, engine connection, enrolled seat keys, two joined bidders and OPEN/COUNTDOWN phase. |

`FastConfig.h` contains `BID3_ENABLE_FAST_CHANNEL`. Its default is 1. Setting it to 0 in **all three sketch folders** disables the new channel for comparison with the original signed-snapshot radio path; it does not implement auction bidding. The working archive hash and unchanged helper hashes are recorded in `legacy_docs/README.md` and `legacy_docs/BASELINE_SHA256.json`.

Read `BIDDING_RULES.md`, `FAST_PROTOCOL.md` and `VALIDATION.md` for behavior and verification. These are compiled and host-tested sources. No board was flashed or RF/acoustic latency measured here; a zero-latency or physically verified result would be an unsupported claim.
