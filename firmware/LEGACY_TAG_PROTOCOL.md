> Legacy reference: this describes BTQ1/BTAG only. For this package's primary button snapshots use BUTTON_PROTOCOL.md.

# BagTrail tag-to-gateway protocol v1

This file is the contract for the next gateway implementation. No tag GPS
coordinates exist. Gateway location comes from its enrolled checkpoint registry.
All multibyte integers below are little-endian unless explicitly marked otherwise.

## Discovery and GATT

Service UUID: `b7610001-7e1d-4e8b-9a73-8f1b0c4d9000`.
Connectable legacy advertisements: flags (3 bytes), complete service UUID
(18 bytes), development manufacturer field (8 bytes), total 29 bytes <=31.
Manufacturer payload: `ff ff 42 54 01 TT` (TT=01/02). Company ID 0xFFFF is
for development only and needs replacement for a commercial product.
Name in scan response: `BagTrail-Tag01` or `BagTrail-Tag02`.
Advertisement interval: 250-300 ms. Advertisement/name alone is unauthenticated.

| Characteristic suffix | Full UUID prefix/suffix pattern | Properties |
|---|---|---|
| 0002 | b7610002-7e1d-4e8b-9a73-8f1b0c4d9000 | READ: identity info |
| 0003 | b7610003-7e1d-4e8b-9a73-8f1b0c4d9000 | READ: unsigned live telemetry |
| 0004 | b7610004-7e1d-4e8b-9a73-8f1b0c4d9000 | WRITE with response: challenge |
| 0005 | b7610005-7e1d-4e8b-9a73-8f1b0c4d9000 | READ: status / signed result |

Use active scanning to obtain the name, or find tags by service UUID. Pause
scanning before connecting. Use one central/transaction at a time. Negotiate
MTU **247** on the client (server maximum 247) for straightforward 84-byte writes
and 190-byte reads; otherwise implement verified long-write/long-read support.
There are no notifications to subscribe to. After writing the challenge, poll
the result every 50-100 ms until its full proof arrives or 5 seconds expires.
The tag ends a connection after 10 seconds. Disconnect after each proof so
other gateways can discover the tag. Advertising restarts on disconnect.

## Info frame (108 bytes)

| Offset | Length | Field |
|---:|---:|---|
| 0 | 4 | ASCII BTI1 |
| 4 | 1 | tag number 1 or 2 |
| 5 | 6 | fixed device ID = eFuse-derived Wi-Fi base MAC bytes |
| 11 | 65 | secp256k1 public key: SEC1 uncompressed 04 + X32 + Y32, big-endian |
| 76 | 32 | SHA-256 of all 65 public-key bytes |

Pin public key + tag number + device ID during trusted USB enrollment using
the Serial lines. Never trust/enroll a new key just because it arrived over
BLE. A valid signature from an attacker-generated key is not a registered tag.

## Challenge request (84 bytes)

| Offset | Length | Field |
|---:|---:|---|
| 0 | 4 | ASCII BTQ1 |
| 4 | 16 | gateway UUID bytes in normal UUID network byte order |
| 20 | 32 | SHA-256 of UTF-8 canonical checkpoint ID string |
| 52 | 32 | new cryptographically random nonce, not all zero |

Example canonical checkpoint ID: `BOM-DEMO-CHECKPOINT-01`. Use the exact string
registered in the backend (case and punctuation matter), not a display alias.
The tag binds these opaque gateway fields into its proof; it does not validate
gateway enrollment or coordinates. Any client can ask for a proof in this demo.
Server/registry authorization and a gateway countersignature are still required.

Responses of length 2 are statuses: `49 00`=I/IDLE, `42 00`=B/BUSY,
`45 CC`=E/error. Error codes: 1 bad length, 2 bad magic/zero nonce, 3 queue busy,
4 rate limited (retry after at least 1500 ms), 5 crypto/counter failure,
6 tag not ON/connected, 7 immediately repeated nonce.
Request writes are acknowledged before signing: write success is not proof
success. One pending work item is queued; one request may be processed at a time.

## Signed response (190 bytes)

| Offset | Length | Field |
|---:|---:|---|
| 0 | 4 | ASCII BTAG |
| 4 | 1 | protocol version = 1 |
| 5 | 1 | tag number |
| 6 | 1 | status flags |
| 7 | 1 | reserved zero |
| 8 | 6 | device ID |
| 14 | 8 | random boot/session ID; changes after wake/reset |
| 22 | 4 | response sequence, starts at 1 each boot |
| 26 | 4 | uptime milliseconds (not Unix time; wraps after ~49.7 days) |
| 30 | 2 | motion sample age ms, or 65535 if invalid/stale |
| 32 | 6 | ax, ay, az: three signed int16, milligravity units (1000 = 1g) |
| 38 | 6 | gx, gy, gz: three signed int16, tenths degrees/second |
| 44 | 2 | MPU die temperature: signed int16, hundredths degrees C |
| 46 | 16 | echoed gateway UUID bytes |
| 62 | 32 | echoed checkpoint hash |
| 94 | 32 | echoed nonce |
| 126 | 32 | signature r, unsigned big-endian |
| 158 | 32 | signature s, unsigned big-endian; normalized to low-S |

Flags: bit0=fresh valid motion, bit1=moving in the last two seconds,
bit2=sensor at 0x69 (AD0-high warning); other bits zero. Invalid motion uses
-32768 in ALL seven signed measurements and age=65535; moving must be false.
When sensor data is invalid, a signed identity proof is still useful for tracing
but must not be interpreted as valid motion/temperature data.

Digest = **SHA-256(ASCII `BagTrail.TagProof.v1` WITHOUT NUL + bytes[0:126])**.
Signature = ECDSA secp256k1 over that exact digest. Signature is raw r||s, not
DER and not personal_sign/EIP-191. No Ethereum recovery byte v is supplied.
A backend can derive the recovery candidate against the enrolled public key
if an EVM ecrecover path is later chosen. Do not substitute keccak, add a
personal-sign prefix, or double-hash before verifying.

The tag verifies its own signature before publishing. Boot ID/sequence help
identify duplicate sessions, but do not replace nonce freshness verification.
The tag rejects only the immediately previous nonce; the verifier MUST enforce
all outstanding/consumed nonces and expiration. Keep challenge issuance/time
and consumption transactionally in the backend for payout-related records.

## Live telemetry (28 bytes, unsigned)

BTM1 at 0..3; tag at4; flags at5; reserved zero at6..7; uptime u32 at8;
sample age u16 at12; seven signed measurements at14..27, same units/order as
the proof. Updated every 200 ms. This is diagnostics only; use signed proof
for authenticated measurements.

## Gateway scan workflow

1. Discover service; capture RSSI observation for diagnostics, not exact range.
2. Connect and negotiate MTU; read info; compare with trusted enrollment.
3. Generate fresh 32-byte random nonce; store outstanding challenge with
   registered gateway ID, canonical checkpoint hash, and short expiration.
4. Write exact 84-byte challenge with response. Poll result. Match ALL expected
   fields, not just tag name/number. If reusing a connection, respect rate limit.
5. Verify exact length, magic, version, reserved/flags, known key/tag/device,
   r/s canonical bounds, signature, request context and still-unexpired nonce.
6. Consume nonce atomically once; reject all later copies of that proof.
7. Gateway adds its registered checkpoint/location, trusted observation time,
   RSSI and full proof. Gateway signs that scan envelope and submits it to
   backend/onchain flow. Tag firmware does not implement gateway signatures.
8. Disconnect. UI reports last-seen checkpoint and freshness. Between scans,
   location is unknown rather than a fabricated continuously tracked coordinate.

Host reference verifier: `tools/protocol.py`; host tests: `tools/test_protocol.py`.
The reference set of consumed nonces is not durable/transactional storage.
Neither BLE encryption/pairing nor gateway access control is configured in v1.
Hardware relay resistance, tamper-proof key storage and trusted gateway location
attestation are outside this prototype. Do not use raw RSSI or a tag signature
alone as an automatic compensation trigger without the backend policy.
