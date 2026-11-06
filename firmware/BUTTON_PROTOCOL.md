# Signed D2 button snapshots, v1

This is a separate protocol extension. It preserves original identity storage, keys, characteristic UUIDs, unsigned diagnostics and legacy tag proof bytes/domains. It is not an auction-intent protocol and contains no auction ID or round/rules binding.

Same service: `b7610001-7e1d-4e8b-9a73-8f1b0c4d9000`; existing challenge characteristic `...0004...`, result read characteristic `...0005...`. MTU 247 is requested; no button notifications are used.

## Challenge and tag response

Challenge: 84 bytes as before, but magic `BTB1` instead of `BTQ1`; gateway UUID at4, checkpoint hash at20, fresh random nonce at52. Original `BTQ1` still returns legacy `BTAG` proof.

New response: **199 bytes**, magic `BTP1`, version1. Offsets 4–125 retain original version/tag/sensor flags/device/boot/sequence/uptime/measurements/gateway/checkpoint/nonce layout. In particular, boot ID14..21, sequence22..25, tag uptime26..29, echoed nonce94..125.

| Offset | Length | Button extension |
|---:|---:|---|
| 126 | 4 | Stable press count since tag boot/wake, little-endian uint32 |
| 130 | 4 | Tag uptime at latest debounced press, little-endian uint32; zero when count zero |
| 134 | 1 | Current debounced pressed state: 0/1 |
| 135 | 64 | Raw big-endian secp256k1 r||s, low-S |

Tag digest: `SHA256(ASCII("BagTrail.ButtonProof.v1") || proof[0:135])`, without terminating NUL. No personal-sign prefix/recovery byte. Invalid sensor flags/sentinels remain checked; valid device/button identity does not require a working MPU.

The separate priority-2 sampler reads D2/GPIO4 with internal pull-up every ~5 ms. Press/release must each stay stable for 30 ms. Held press increments once. Counts are RAM state protected by a critical section; no per-press flash writes. Overflow refuses new button proofs rather than wrapping silently. Sampling is paused naturally during deep sleep; D2 is not configured as its wake input.

## Gateway-signed envelope

**337 bytes**, magic `BGB1`, version1. Envelope offsets 4–73 are the existing tag flags, gateway UUID/checkpoint/boot ID/sequence/uptime/RSSI layout.

- 74..272: complete 199-byte tag button proof.
- 273..336: gateway r||s, low-S.
- Digest: `SHA256(ASCII("BagTrail.GatewayButtonScan.v1") || scan[0:273])`.

Gateway creates a fresh challenge, validates exact enrolled tag/key/device and request context, verifies the tag signature and countersigns the new envelope. Current gateway identity/NVS namespace and checkpoint remain unchanged. A snapshot count lower than the last same-boot count, or a nonincreasing proof sequence, is rejected. New boot IDs initialize a new baseline. Same-boot counter increases yield a delta; a held state alone cannot manufacture repeated presses.

Serial records: `BUTTON_STATE_JSON` schema `bagtrail.button_scan.v1` carries `gateway_button_scan_hex`; `BUTTON_EVENT_JSON` schema `bagtrail.button_event.v1` is a derived summary referencing `scan_digest_sha256`. JSON wrapper counts, delta, baseline and public identity strings are descriptive, not independent signed fields. Canonical envelope plus enrolled keys and prior accepted state are authoritative. No legacy `SCAN_JSON` is emitted by this gateway extension; downstream parsers must select the new schema. The legacy tag protocol remains available to legacy gateways.

`tools/button_protocol.py` verifies the complete envelope using explicit enrolled keys and caller-supplied outstanding challenge/age. Used-nonce state must be durable and atomically consumed in an actual backend. Gateway-origin challenges are not server-issued. A server cannot prove independent issue time by extracting a challenge from the same incoming packet. Current records are diagnostic hardware observations, not consent to an auction or proof of timely entry before a deadline.

The first synchronization and any new tag boot report the total current count without emitting historical presses as new live events. An advanced count may aggregate several unobserved presses and may arrive late. There is no durable radio event queue or exact per-press transcript. Physical tests are needed to establish latency/loss behavior. Do not infer hard OFF from radio loss or a routine BLE disconnect.
