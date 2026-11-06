# Bid3 V4 — short integration brief

**Use all three V4 sketches plus `../bridge/bid3_bridge.py`. All USB serial links use 115200 baud.** The earlier 460800/BID3_EVENT protocol and the repository's unpatched bridge do not match this release's acknowledgement/health handling.

The gateway preserves your working BLE discovery and signed challenge/response. After authentication, it keeps each connection open and receives individually signed JOIN, LEAVE and BID notifications. Each BID signs the quote's stateVersion captured at the physical button edge. The gateway verifies it and forwards the existing engine-compatible `Bid3.Intent.v1` signature. Snapshot count deltas are never converted into auction bids.

## Connect to the existing engine

From the repository's `firmware/` directory:

```sh
python3 -m pip install -r ../bridge/requirements.txt
python3 ../bridge/bid3_bridge.py --list-ports
python3 ../bridge/bid3_bridge.py --port /dev/cu.YOUR_GATEWAY_PORT --engine "$ENGINE_URL" --token "$BRIDGE_TOKEN" --baud 115200
```

Set ENGINE_URL to the existing engine's `ws://...` or `wss://...` base URL and use its existing BRIDGE_TOKEN. Close Arduino Serial Monitor first. The included bridge removes the old serial batch wait, echoes the correct tag session in ACKs, checks gateway status and WebSocket liveness, and requests tag re-announcement after connecting or changing the active auction.

Use **`INTENT_SIGNATURES_REQUIRED=1`** on the engine and enroll each seat's `publicKey`. `integration/auction-template.json` contains your actual public keys and **rules.countdownMs = 10000**. Fill in the real listing/auction identifiers and publish the rules before opening. For a newly seeded test auction, the engine setting is `SEED_COUNTDOWN_MS=10000`; it does not change existing stored auctions, and the seed does not automatically enroll public keys. Prefer creating the properly enrolled auction from the supplied template. No device private key or Arkiv publisher key belongs in firmware or the bridge.

## Rules and feedback

Two same-quote presses: the engine accepts the first valid request it processes and rejects the other as STALE. It never raises the second bidder to an unseen price. Every accepted bid restarts the full 10 seconds; rejected presses do not. With a valid bid and competition, expiry awards the accepted leader even if that tag has intentionally switched OFF. No bids means no automatic winner. Signal/infrastructure loss pauses the engine; Arkiv publication runs through the existing asynchronous outbox/worker.

Green plus tone means engine-accepted BID; red plus tone means refused BID. A standalone BUTTON VERIFIED screen confirms input authentication only. Tag LEDs stay static. The tag prints `BID3_LATENCY_JSON` with `edge_to_tag_ack_ms`, measured on its own clock, for actual button-to-engine-acknowledgement testing; gateway LED/buzzer actuation is a separate physical measurement.

**Current engine scope:** one active auction, using its existing v1 intent contract. That signature does not include auctionId/epoch. Close the previous lot, stop pressing, and drain/acknowledge pending events before changing the active lot; the bridge requests fresh JOINs for the next lot. This release does not add cryptographic cross-round replay protection, parallel auction routing, payments or escrow. Those require a coordinated engine/signature-contract change.

See `VALIDATION.md` for actual build/test results. RF, real OLED/buzzer timing and maximum end-to-end latency still require testing on the assembled devices. This update changes firmware and the matching bridge. Engine/web runtime code and cloud deployment are unchanged.
