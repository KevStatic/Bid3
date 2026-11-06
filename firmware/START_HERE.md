# Bid3 V2 — connection fix and static tag LED

6 November 2026. Replaces the earlier Bid3 firmware package. Source release for two XIAO ESP32-C3 bidder tags and one ESP32-WROOM gateway. Read [README.md](README.md) for repository integration status, and RULES.md and ENGINE_PROTOCOL.md before connecting a live auction engine. The existing repository bridge does not yet implement this V2 protocol.

## Files to upload

- `Tag01/Tag01.ino` to physical Tag 01; board **XIAO_ESP32C3**.
- `Tag02/Tag02.ino` to physical Tag 02; board **XIAO_ESP32C3**.
- `Gateway/Gateway.ino` to the gateway; board **ESP32 Dev Module**.
- Keep all supplied headers beside each sketch. `shared/` is the canonical tag/common source; the sketch folders contain matching copies so Arduino IDE can open each sketch directly.
- Use Espressif Arduino ESP32 core **3.3.12**, its bundled BLE and crypto libraries, and the default application partition. The default XIAO tag build uses NimBLE; the default ESP32 gateway build uses Bluedroid. Do not enable Erase All Flash. Tag and gateway private keys remain in their existing NVS namespaces; do not swap tag sketches between devices.

## Connection fix in this release

The earlier gateway waited for an engine ARM before connecting, so merely uploading it left both seats unknown. It also depended on name/service discovery arriving together and used an optimistic MTU value before negotiation completed. V2 connects and checks both tags immediately, **without an engine, public-key enrollment or ARM being required for the BLE transport link**. The engine and trusted gateway pin are still required before accepting auction requests.

Tags now advertise a compact marker in the primary 29-byte advertising packet, with the optional name in a separate scan response. The gateway supports those separate packets, waits for the actual MTU negotiation event, and re-discovers GATT services after reconnect. It prints explicit discovery, connection, enrollment and session states.

The radar's bottom arc is also preserved: the obsolete footer-clearing rectangle no longer erases its lowest dots.

The tag LED is **steady dim green whenever its slide switch is ON, and OFF when the slide switch is OFF**. It no longer blinks for joins, bids, leadership, refusals, closed rounds or faults. It is a switch/power indicator, not evidence that a bid was accepted.

## Other behavior

- Gateway USB Serial uses **460800 baud** to reduce transfer time; the tag enrollment ports remain 115200. Set the bridge baud to match. If the USB adapter cannot reliably sustain 460800, change `Config::SERIAL_BAUD` and the bridge together.
- Persistent connections to both tags, subscribed BLE notifications, and individual round-bound signed JOIN, LEAVE and BID intents replace reconnect/snapshot polling.
- The button quote is captured at its initial down edge, before debounce. A press never silently bids a later, more expensive quote.
- 1 ms input task, 12 ms stable press/release filtering, one bid per physical press, no repeat while held. These are configured timings, not measured radio latency guarantees.
- Signed session setup uses the original tag/gateway secp256k1 identities. Every bid remains individually signed. See LATENCY_AND_SYNC.md for the remaining delay terms and physical measurement procedure. Fast gateway commands and liveness use session-bound HMAC-SHA256, avoiding a new public-key signature for every heartbeat or acknowledgement.
- Explicit engine acknowledgements; receipt is distinct from acceptance. Retries reuse exactly the same signed intent. No bid batching or conversion of an accumulated historical press count into new bids.
- Green + a short tone for an accepted BID; three red + low-tone pulses for a refused BID. One dedicated task owns both LEDs and the buzzer, using one timeline independently of OLED rendering; Serial input also runs independently of display I/O. A sale has a distinct three-pulse green/tone pattern.
- Existing rotating Ethereum mark and gateway scenes remain; BID3 stays below the startup mark. The radar page has no BID3 label (including its header/footer), while other pages retain their branding. The original startup melody from the supplied Sounds.h is restored. The old DEMO GATE 01 location label is removed. Confirmed results get a SOLD overlay.
- The authoritative rule is now **10 seconds since the last accepted bid**. OFF prevents further bids but leaves an already accepted bid binding. See RULES.md.

## Wiring

Tags: button D2/GPIO4 → normally open momentary contact → GND. Slide switch COM→GND, ON→D1/GPIO3. LED D3/GPIO5 through 330 ohms. MPU SDA6/SCL7, VCC3V3. Protected battery directly to rear BAT+/BAT−. Antenna and NFC unchanged.

Gateway: OLED SDA21/SCL22, green LED25, red LED26 (each through its existing resistor), buzzer IO27, existing common ground and compatible switched peripheral supply. No GPIO33 or gateway battery. Existing active/passive buzzer mode and polarity settings are loaded from NVS. A fixed-tone active buzzer reproduces rhythms rather than pitched tones.

## Your gateway is already pinned in both tag builds

The two tags include the public gateway key you supplied. **No GATEWAY_KEY command is needed for this gateway.** Upload the matching V2 sketches to all three devices and restart them. Existing tag/private gateway identities are preserved.

Expected gateway UUID: `79b55b3b71144f3ab9d4241af367f9fe`.
Expected gateway public-key fingerprint: `068abe81ebff2c1a0115ee666a0deb01a1cfb4c054000aaac7d287b76a1c41a8`.

The public-key pin is in `shared/AuthorityConfig.h` and the identical copies beside both tag sketches. It is not a private key. If the gateway identity is deliberately replaced later, update that build-time pin and rebuild both tag sketches. A nonempty build pin takes priority over old USB enrollment; the USB enrollment command is explicitly refused in that mode. To use USB enrollment instead, first build with the pin empty. Do not erase flash to repair an ordinary connection.

A BLE transport connection and authenticated auction participation remain separate states. The pinned gateway signs ARM context; the tags still verify that signature before joining a real auction.

## Connecting to the team engine

The firmware is separate from the repository's FastAPI engine, bridge and Arkiv publisher. The existing bridge uses a different serial contract; see README.md for the integration gap. BLE discovery/connection runs immediately. To start authenticated bidding, the gateway waits for a trusted USB bridge to send ARM/STATE/DECIDE/RESULT commands, documented completely in ENGINE_PROTOCOL.md. Uploading firmware alone does not start an auction or manufacture accepted bids.

The engine owns ordered bid acceptance, the 10-second countdown, transactional persistence and the final winner. The gateway displays a confirmed result; it never silently replaces the engine on a disconnected laptop. `tools/bid3_rules.py` supplies an executable policy reference, and `tools/bid3_protocol.py` independently verifies tag intents for the bridge/engine integration. Neither is a deployed service.

The bridge must send `BID3 PING` at least every 250 ms. Missing bridge liveness pauses the hardware. Quote/control messages go to tags every 250 ms; authenticated tag liveness is sent every 250 ms. Missing tag liveness or an unacknowledged intent stops bidding and reports uncertainty. Successful radio receipt alone never turns the gateway green.

## Operating behavior

The slide switch is now an auction JOIN/LEAVE control. **OFF keeps BLE alive** for prompt re-entry and liveness. This deliberately changes the old deep-sleep behavior and increases standby battery consumption. It does not physically isolate the battery. The D2 button is not a power switch.

Tag LED: steady dim green while the slide switch is ON; OFF while the slide switch is OFF. Feedback/status comes from the gateway and engine. A paused/faulted tag cannot submit a new bid even though this static power indicator stays ON.

Gateway red sparse pulse means PAUSED. No winner is created by silence, a missing tag, a reconnect, or a browser timer. A physical OFF/acknowledged LEAVE is different from radio loss.

A tag allows at most 32 fresh auction sessions per boot to retain its anti-replay nonce history. At that limit, reset and resynchronize it while the engine is paused. Intent queues, counters and replay history are RAM state; a reset creates a new boot/session and requires engine resynchronization, not replay of old presses.

## Verification and deployment boundary

See VALIDATION.md for the exact compilation and host checks. No physical device was flashed or bench-tested in this task. True zero latency and perfect cross-device synchronization cannot be promised by source inspection. The gateway LED/tone envelope is synchronized in software; actual onset skew, radio latency, battery use and loss rates must be measured on the assembled hardware. The final Arduino source and upload instructions are supplied without representing those measurements as completed.

## Expected output before the backend starts

Gateway Serial Monitor: **460800 baud**. Tags: **115200 baud**.

```
BID3_LINK_JSON={"schema":"bid3.link.v2","tag":1,"state":"DISCOVERED","detail":"advertisement found"}
BID3_LINK_JSON={"schema":"bid3.link.v2","tag":1,"state":"CONNECTING","detail":"BLE transport; engine ARM not required"}
BID3_LINK_JSON={"schema":"bid3.link.v2","tag":1,"state":"CONNECTED","detail":"BLE ready; waiting for engine ARM"}
BID3_SCAN_STATUS scanning=0 tag1=CONNECTED tag2=CONNECTED engine=WAIT_ARM
```

If the key has not been enrolled, CONNECTED instead says `gateway public key needs enrollment on this tag`. This is a separate, explicit authentication requirement, not a discovery failure. Health may remain `unknown`/PAUSED before an authenticated engine session; use LINK/SCAN_STATUS to distinguish physical connection from auction readiness.

If `tag_identity_differs_from_enrollment` appears, compare actual public identity lines. This release retains the two tag identities you supplied. Do not erase flash to force a match. If characteristics are missing, upload the matching V2 tag sketches, not the old BagTrail snapshot firmware.
