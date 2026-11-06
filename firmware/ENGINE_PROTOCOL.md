# Bid3 firmware ↔ trusted bridge ↔ engine contract v1

## Scope and transport

Gateway USB Serial is 460800, newline-delimited commands/JSON. It is a **trusted local control boundary**, not an unauthenticated internet API. A deployed bridge must authenticate its outbound WSS session, bind its enrolled gateway/auction, validate server responses and reject stale sessions. Never expose arbitrary Serial commands to a public HTTP endpoint. The engine is the sole auction authority; the gateway never finalizes locally on a missing server.

This V2 contract is not yet implemented by the repository's existing bridge/engine; see [README.md](README.md) for the differences. The web `snapshot`/`state`/`bid` contract remains the engine's responsibility. This firmware adds a private **quoteVersion**: advance on accepted price change or recovery, not on Arkiv publication/health-only UI updates. General `stateVersion` can change more often. A future coordinated integration must publish 10000 as countdownMs in AuctionDefinition and seller rules; hashes must match the same ordered JSON contract. This hardware import does not change those backend or web contracts.

## Canonical wire format

All integer fields below are unsigned little-endian. No packed C struct, JSON serialization, UTC clock on tag, or personal-sign prefix is used. New characteristic UUIDs share the original service `b7610001-7e1d-4e8b-9a73-8f1b0c4d9000`:

- INFO `b7610006-...`: READ 116 bytes (legacy 84 accepted by gateway): ASCII B3I1, tag at4, device6 at5, uncompressed public65 at11, boot8 at76; optional 32-byte SHA256 of the tag's trusted gateway public key at84 (all zero if not enrolled). The fingerprint is diagnostic and does not replace signed-session verification.
- CONTROL `b7610007-...`: WRITE with response, signed ARM or MAC control.
- EVENTS `b7610008-...`: NOTIFY individual signed intents or MAC liveness.

The suffix is always `7e1d-4e8b-9a73-8f1b0c4d9000`. MTU247 requested; minimum ATT MTU199 is required for a 196-byte intent. No fragmented-intent fallback silently changes semantics. Identity must match pinned key/device enrollment; advertised names only hint discovery.

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 4 | B3F1 |
| 4 | 1 | version1 |
| 5 | 1 | kind |
| 6 | 1 | target/source tag1 or2 |
| 7 | 1 | ACK reason; zero in signed intents |
| 8 | 6 | enrolled device |
| 14 | 8 | tag boot |
| 22 | 16 | fresh gateway-issued session nonce |
| 38 | 32 | SHA256(UTF8 auctionId) |
| 70 | 32 | rulesHash bytes, without 0x |
| 102 | 4 | epoch |
| 106 | 4 | quoteVersion |
| 110 | 4 | direction-specific sequence |
| 114 | 8 | exact quoted NEXT price, minor units |
| 122 | 4 | tag press count; in ACK: acknowledged intent sequence |
| 126 | 4 | tag edge/heartbeat uptime; in control: byte126 phase, byte127 leader tag (0 if none), bytes128–129 zero |
| 130 | 2 | reserved zero |
| 132 | 64/16 | raw low-S r||s signature, or first16 HMAC-SHA256 bytes |

Kinds: ARM1, QUOTE2, ACK3, PAUSE4, CLOSE5, JOIN16, LEAVE17, BID18, HELLO19 (reserved), HEARTBEAT20. Phases: LOBBY0, OPEN1, COUNTDOWN2, PAUSED3, LOCKED4. Reasons: ACCEPTED0, STALE1, LEADING2, NOT_ACTIVE3, NOT_OPEN4, CLOSED5, CEILING6, UNHEALTHY7, INVALID8.

Sign SHA256(ASCII domain || first132bytes) with secp256k1. ARM domain is `Bid3.Arm.v1`; intent domain is `Bid3.Intent.v1`. Signatures have no recovery byte, require 0<r<N and 0<s<=N/2, and are 196 bytes total. `tools/bid3_protocol.py` is an independent verifier.

## Session authentication and fast controls

Each tag pins the gateway public key using trusted USB enrollment. ARM is signed by that gateway and targets the exact enrolled tag and current boot. One ARM is accepted per connection. A 32-entry per-boot nonce history rejects reused ARM sessions; reset/resynchronize at exhaustion.

Both sides compute static secp256k1 ECDH using their existing private key and enrolled peer public key. Session key:

`SHA256(ASCII("Bid3.Session.v1") || sharedPointX32_BE || ARM[8:106])`.

ARM[8:106] binds tag device/boot, fresh nonce, auction hash, rules and epoch. This does not provide forward secrecy. Private keys and derived session keys are never exported. Gateway controls use HMAC-SHA256 over `ASCII("Bid3.Control.v1") || body132`, truncated to16 bytes. Tag liveness uses the distinct domain `Bid3.Liveness.v1`. MACs total148 bytes. Verify MAC in constant-time and require strictly increasing per-direction counters. Repeated intent retransmissions preserve the entire signed196 bytes; they are idempotent, not fresh events.

HMAC control receipts and liveness are not transferable tag signatures. Every actual JOIN/LEAVE/BID retains its own tag signature and can be independently verified by the engine. The gateway does not countersign and self-verify every button edge, reducing unnecessary critical-path work. Existing boot identity self-tests remain.

## Bridge commands

Amounts and counters are decimal integers. Hash/session hex has no 0x prefix. Space-separated tokens, exact arity; no embedded JSON. Send one full line at a time. Max419 characters. Unknown/oversize lines are rejected or faulted. PING every 250 ms; missing for1000 ms reports pause.

```
BID3 PING
BID3 ARM <auctionHash64> <epoch> <rulesHash64> <quoteVersion> <nextPriceMinor> <phase> <leaderTag>
BID3 STATE <quoteVersion> <nextPriceMinor> <phase> <leaderTag>
BID3 DECIDE <tag> <sessionHex32> <intentSeq> <reason> <serverSeq> <quoteVersion> <nextPriceMinor> <phase> <leaderTag> END
BID3 PAUSE
BID3 CLOSE
BID3 RESULT <winnerTag> <hammerPriceMinor> <finalSeq> <countdownGeneration>
```

- ARM is accepted only once per gateway boot. A new round requires explicit gateway restart under engine-controlled recovery; the engine remains paused until sessions resynchronize. Do not erase NVS. Multi-round hot rearming is not implemented in this release.
- STATE updates quotes/phase without deciding a pending intent. Do not use it as an acceptance ACK. Do not resume until both sessions and critical health are freshly verified.
- DECIDE must reference the current session and exact outstanding intent. Commit acceptance/rejection/idempotency first. For an accepted opening BID, nextPrice is the NEXT rung (e.g.10500), while the standing accepted price remains10000 in engine state. Even JOIN and LEAVE require DECIDE. Refused bids retain the standing price and hammer deadline.
- RESULT is an instruction to display an **already durably committed** engine result, with the established leader. Send it after the engine's 10-second closing checks. It is not a command for the gateway to compute a winner. Repeated RESULT does not replay its sale effect. CLOSE represents a terminal unsold/cancelled state without implying a sale.
- Keep the gateway connected while an accepted bidder is physically OFF; OFF is a signed withdrawal from future bidding, not cancellation of the leading bid.

## Gateway output

`BID3_SESSION_JSON`: current tag, nonce, tag boot, auction hash, epoch. Register this fresh session only over the authenticated current bridge connection and bind it durably to the enrolled gateway and open epoch. These nonces are gateway-issued, not independently server-issued. Old sessions must remain revoked across backend restarts; do not treat an arbitrary incoming nonce as fresh simply because it appears in a packet.

`BID3_EVENT_JSON` schema `bid3.intent.v1`: tag, gateway_boot, rx_order, received_us, verify_us, intent_hex. Decode and verify the tag signature/enrollment independently. Check session, epoch, rules, freshness, sequence/idempotency and signed quote. Gateway rx_order is private transport evidence, not an independent globally trusted timestamp. Tag uptime and micros wrap are diagnostics, not sale clocks.

`BID3_HEALTH_JSON`: health/status and explicit reasons. Pause engine on a critical fault, session loss, queue overflow, stale bridge or missed authenticated tag heartbeat. Reconnection never resumes automatically. Missing an unacknowledged request must not be interpreted as a user LEAVE.

`BID3_RESULT_ACK_JSON`: display acknowledgement, not an onchain settlement receipt.

No private raw frame, permanent device ID, enrollment public key or session nonce belongs on public Arkiv entities. Publish only per-round aliases and the agreed public schema.

## Closing and publication integration

At10 seconds since last accepted BID, serialize deadline evaluation with input admission. Verify fresh health and countdown generation; lock one result/event/outbox transaction before sending RESULT. A browser timeout or gateway OLED animation is not authority. On restart recover PAUSED and resynchronize rather than trusting an old monotonic deadline.

Publish the definition before opening, accepted bids individually, coalesced snapshots and the final result through a durable Arkiv outbox. Use the actual shared schemas and configured chain from the team repo. This package contains no RPC wallet, write key or Arkiv worker and must not be described as already publishing records.

## V2 transport diagnostics

The gateway connects and subscribes to both tags before ARM. `BID3_LINK_JSON` schema `bid3.link.v2` reports DISCOVERED, CONNECTING, CONNECTED, RETRY and REJECTED with a detail string. This does not grant ACTIVE status. `BID3_SCAN_STATUS` distinguishes connected BLE transport from WAIT_ARM. The tag primary advertisement uses manufacturer bytes `ff ff 42 33 02 <tag>` beside the existing service UUID; its display name is optional for discovery. Advertisement hints never replace pinned enrollment or tag signatures.

The tag LED is now static ON/OFF with the physical slide switch, per user instruction. Update the web seat-page LED legend accordingly; tag LED patterns no longer carry auction acknowledgements. Gateway light/tone effects and engine decisions remain authoritative for acceptance feedback. Tags stay connected while OUT as before.

These delivered V2 tag builds pin the owner-supplied gateway public key at build time; no manual enrollment is needed for that gateway. The app/private-key NVS identity remains unchanged.
