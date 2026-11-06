# Bid3 V6 OFF/LOST extension (V5 input and V4 bid transport retained)

All integers below are little endian; packet sizes include their authenticators. The original BLE manufacturer bytes, service UUID, INFO/TELEMETRY/CHALLENGE/RESPONSE UUIDs, BTB1 request, BTP1 proof, signature domains, enrollment and NVS namespaces are preserved. `BUTTON_PROTOCOL.md` documents that original path. It remains a detection/diagnostic fallback; historical count deltas never create auction intents.

## Session establishment

1. Gateway discovers the original BagTrail advertisements and validates the original enrolled signed 199-byte button proof.
2. Optional event characteristic `b7610006-7e1d-4e8b-9a73-8f1b0c4d9000` is READ/NOTIFY; separate control characteristic `b7610007-7e1d-4e8b-9a73-8f1b0c4d9000` is WRITE with response. MTU must fit 144+3. The existing path requests MTU247.
3. Static secp256k1 ECDH X coordinate is precomputed from the stored device key and enrolled peer public key. HKDF-SHA256 uses salt=proof[94:126], IKM=sharedX, info=ASCII `Bid3.FastSession.v4` + boot8 (proof[14:22]) + gatewayUUID16 (proof[46:62]). Output=32 bytes.
4. Gateway subscribes and sends MAC-authenticated INIT. The tag enables the extension only after that MAC verifies. It sends a signed JOIN/LEAVE and independent authenticated heartbeats. No GPIO arm gate or USB enrollment is involved.
5. Gateway requests a 7.5–15 ms BLE connection interval, zero peripheral latency, after baseline validation. This is a requested interval, not a measured delivery bound; a declined request retains the current interval.

## Common 64-byte event/heartbeat header

| Offset | Size | Meaning |
|---:|---:|---|
| 0 | 4 | B4E1 (event) or B4H1 (heartbeat) |
| 4 | 1 | version=1 |
| 5 | 1 | tag=1/2 |
| 6 | 1 | JOIN1 / LEAVE2 / BID3 / PRESS4; heartbeat=0 |
| 7 | 1 | event=0; heartbeat physical switch ON flag |
| 8 | 32 | original authenticated proof nonce |
| 40 | 4 | event sequence or independent heartbeat sequence |
| 44 | 4 | quoted engine stateVersion; FFFFFFFF if absent |
| 48 | 4 | local observed button edge / event uptime |
| 52 | 4 | physical debounced press counter |
| 56 | 8 | tag boot ID |

A signed event is **144 bytes**: header64, signature r32||s32 at64, truncated HMAC-SHA256 at128 (16 bytes). Signature is low-S secp256k1 over SHA256 of the existing engine canonical UTF-8 message:

`Bid3.Intent.v1|TAG1|<bootHex>-<nonceHex>|<sequence>|BID|<stateVersion>`

For JOIN/LEAVE the final field is empty. PRESS uses the same form with kind PRESS, but is verified locally and never sent to the auction engine. HMAC input=ASCII `Bid3.FastEvent.v4` + first128 bytes. Thus header diagnostics excluded from the engine canonical text are still authenticated to the gateway.

A heartbeat is **80 bytes**: common header64 plus HMAC16 over ASCII `Bid3.FastHeartbeat.v4` + header64. It is sent about every250ms. The gateway marks loss after1500ms without a valid heartbeat/event once authenticated; initial negotiation has an8s grace. Timeout thresholds are detection policies, not instantaneous physical loss detection.

## Control (88 bytes)

B4C1 at0, version1 at4, tag at5, command at6 (INIT1/STATE2/ACK3/RESYNC4), proof nonce32 at8, monotonic control counter32 at40, engine version32 at44, acknowledged event sequence32 at48, phase at52 (PAUSED0/LOBBY1/OPEN2/COUNTDOWN3/CLOSED4), result at53 (RECEIVED0/ACCEPTED1/REFUSED2), engine-fresh flag at55, next price64 at56, reserved zeros through71, HMAC16 at72. MAC input=ASCII `Bid3.FastControl.v4` + first72 bytes.

Controls refresh every200ms and on state changes. A tag can sign a BID only after accepted JOIN, current engine state, a valid quote captured at the edge, and OPEN/COUNTDOWN. One signed event waits for its exact sequence ACK; retries every400ms resend identical bytes, never a new bid/price. After3s without ACK or2.5s without authenticated controls the tag disconnects and re-authenticates. Fast control writes have a1.5s watchdog. Overflow fails closed; no dropped input is invented as a bid.

## USB contract

115200 baud, newline-delimited JSON. Gateway emits AUCTION_EVENT_JSON (JOIN/LEAVE/BID with session, seq, sig, and BID stateVersion) and LINK OK/LOST. Bridge returns AUCTION_STATE_JSON and AUCTION_ACK_JSON with the **matching session**. The bundled bridge adds AUCTION_BRIDGE_JSON for engine liveness and reads AUCTION_STATUS_JSON for running gateway health. It accepts only the expected V4 running-status schema. Legacy proof/diagnostic lines remain separate.

The engine's v1 signature does not bind auctionId or epoch. This extension authenticates the RF session but does not change that engine contract. Operate one active lot and drain pending work before changing it. Transport/session binding does not itself supply cross-round replay protection.

## V5 UI-only input receipt

`B5I1`, 80 bytes: same common header layout, version1, kind=PRESS4, byte7=held0/1, independent monotonic input sequence at40, quote version44 (diagnostic), observed debounce completion time48, count52, boot56. HMAC16 at64 covers ASCII `Bid3.ButtonInput.v5` + first64 bytes with the existing authenticated session key. This packet has no ECDSA signature and is never forwarded as a bid. The original individually signed BID contract is unchanged.

The 2 ms tag sampler sends press and release receipts without waiting for the main signing loop. It briefly repeats identical packets at 20 ms intervals; the gateway deduplicates the input sequence, enforces nondecreasing count, and checks nonce, boot, tag and MAC before updating UI. A new authenticated BLE session resets that replay window. Replayed frames cannot retrigger the OLED. A held button does not fabricate extra bids.

A dedicated core1 input task verifies the receipt and queues the UI update. ECDSA processing runs on core0 so it cannot monopolize the OLED loop's core. Urgent OLED frames replace the pending animation snapshot and restart at page0; input receipt visibility does not wait for the 25 fps animation timer. The original 400 kHz page-at-a-time I2C driver/recovery behavior is retained. Press visibility lasts at least 80 ms even when an engine ACK is already available; after that the engine outcome may replace it. Release updates do not erase the outcome. Both tags' current input rows remain represented.

Standalone JOIN/LEAVE packets are locally acknowledged RECEIVED when there is no fresh engine state. This clears the tag's transport wait without admitting it to an auction or repeatedly disconnecting. Offline BID is REFUSED. Fresh bridge connectivity requests signed re-announcement. The status line keeps `build=V4_WORKING_BASE` for existing bridge compatibility and adds `firmware=V5_LIVE_INPUT`. All three sketches need V5 for the new receipt; the deployed V4 bridge does not need replacement.

Advertising payload/service/enrollment are unchanged; advertising interval is 50–75 ms instead of 250–300 ms. Requested established connection interval is 7.5–15 ms with zero peripheral latency. Missing-sensor configuration retries are deferred while connected. These remove avoidable waits, but cold authentication and actual button-to-pixel timing remain hardware measurements, not a zero-latency claim.

## V6 switch and loss state

The existing heartbeat byte7 now drives participation availability after MAC/context verification. The tag emits a heartbeat immediately on a debounced switch change; periodic 250 ms heartbeats remain. Heartbeat flag0 means intentional OFF. Missing/disconnected authenticated liveness uses the existing 1500 ms threshold and means LOST, not a fabricated LEAVE. Signed JOIN/LEAVE updates the same physical-state view, ordered against heartbeat observations by tag uptime so a delayed older JOIN cannot overwrite a newer OFF observation.

OFF suppresses radar presence, new button-input overlays for that tag, and new BID/JOIN forwarding. Tag-side participation generations discard unsent work from before OFF, even after rapid OFF/ON. A press whose signing was interrupted by OFF is discarded before transmission without leaving a sequence gap. Already transmitted work retains exact retry/deduplication semantics; the engine determines its accepted result.

The matching engine isolates LINK LOST to UNKNOWN for that seat. Other ACTIVE seats and the current countdown continue. LINK OK alone is not renewed admission: a signed JOIN is required. Infrastructure-wide pauses remain separate. No wire-size, UUID, signature, key, pricing, Arkiv schema or bridge migration is introduced. Status preserves build=V4_WORKING_BASE and reports firmware=V6_TAG_OFF_FIX.
