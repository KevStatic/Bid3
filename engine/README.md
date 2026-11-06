# Bid3 engine

The single authority for every auction: it orders paddle presses, prices bids, runs the hammer countdown and declares the winner. Browsers only render what it says; the gateway only reports what the tags did.

## Run it locally

```bash
cd engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m bid3_engine              # http://localhost:8010
python -m pytest -q                # 39 tests
```

On first start it seeds and opens the demo auction `bid3-003`, with paddles `TAG1 → K7` and `TAG2 → M4` (change with `SEED_TAGS`). Settings are in `.env.example`.

Point the web app at it with `NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:8010` (and `NEXT_PUBLIC_ENGINE_HTTP_URL=http://localhost:8010`).

## How it decides

All rules live in `bid3_engine/auction.py`, a pure state machine with no I/O and the clock passed in, so every scenario is a plain unit test.

```
DRAFT --open--> LOBBY --2 paddles on--> OPEN --first BID--> COUNTDOWN --hammer--> SOLD_LOCKED
                  ^                       |                   |  ^
                  +--- a paddle leaves ---+       BID restarts +--+
            LOBBY/OPEN/COUNTDOWN --signal lost / bridge or gateway down--> PAUSED --all back--> (resume)
            LOBBY/OPEN --time limit, no bids--> UNSOLD          any --operator--> CANCELLED
```

- Each accepted BID costs `price(bidCount)`, makes the presser the leader and restarts the countdown.
- The leader can't outbid themselves; switching off doesn't withdraw a leading bid.
- A press whose `stateVersion` predates the latest bid is refused as `STALE`.
- Retried intents (same tag, session, seq) count once.
- While paused, nothing can be won.
  - If the bridge or gateway drops, every switched-on paddle becomes "signal lost" until it re-announces itself.
  - On resume, a running countdown restarts in full.
- After a restart, a live round comes back paused, because the old deadline can't be trusted.

`pricing.py` and `rules_hash.py` match `web/src/lib/pricing.ts` and `rules-hash.ts` exactly. `tests/test_vectors.py` checks this against vectors generated from the TypeScript; regenerate them after changing either side:

```bash
node --experimental-strip-types engine/scripts/make_vectors.mjs   # from the repo root
```

## API

| | Endpoint | Auth |
|---|---|---|
| Health | `GET /health` | none |
| State | `GET /auctions`, `GET /auctions/{id}` | none |
| Live stream for the web app | `WS /auctions/{id}/stream` (messages in `web/src/lib/types.ts`) | none |
| Gateway bridge | `WS /bridge?token=…` | `BRIDGE_TOKEN` |
| Create / open / pause / resync / cancel | `POST /auctions`, `POST /auctions/{id}/open`… | `Bearer ADMIN_TOKEN` |
| Audit journal (every input, accepted and refused) | `GET /auctions/{id}/journal` | `Bearer ADMIN_TOKEN` |
| Outbox for the Arkiv worker | `GET /outbox`, `POST /outbox/{id}/published`, `POST /outbox/{id}/failed` | `Bearer WORKER_TOKEN` |

Create a new lot:

```bash
curl -X POST localhost:8010/auctions -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{
  "auctionId": "bid3-010", "listingId": "lot-010", "category": "Electronics",
  "rules": {"startPriceMinor": 5000, "stepBps": 500, "countdownMs": 5000, "ceilingMinor": 50000, "timeLimitMs": 600000},
  "seats": [{"tagRef": "TAG1", "alias": "Q2"}, {"tagRef": "TAG2", "alias": "V9"}]
}'
curl -X POST localhost:8010/auctions/bid3-010/open -H "Authorization: Bearer $ADMIN_TOKEN"
```

The most recently opened auction is the one the gateway's presses go to. Opening it immediately sends the connected bridge the new lot's state (with its `auctionId`). Paddles then need to JOIN the new lot: the `firmware`-branch bridge sends `CMD=STATUS` for that automatically. With the bridge on `main`, switch each paddle off and on (or type `join TAG1` in `--keyboard` mode).

## What goes to Arkiv

Every transition is committed atomically to SQLite: the new state, its journal lines and any outbox records.

- **Opening:** queues an `AuctionDefinition` with the rules hash.
- **Each accepted bid:** queues an `AuctionBid`.
- **Close:** queues an `AuctionResult` with a transcript digest over the bids.
- **Snapshots:** an `AuctionSnapshot` every `SNAPSHOT_INTERVAL_MS` while the round is changing, keeping only the newest unpublished one.

The worker drains this; the live round never waits on it.

## Deploy (Railway)

1. New service from the repo, root directory `engine`; it builds from the `Dockerfile`.
2. Attach a volume at `/data` (the Dockerfile has no `VOLUME` line because Railway rejects it).
3. Set `BRIDGE_TOKEN`, `ADMIN_TOKEN`, `WORKER_TOKEN` (random) and `CORS_ORIGINS=https://<your-vercel-domain>`. On Railway the engine refuses to start if any token is empty; on another public host set `REQUIRE_TOKENS=1` to get the same check.
4. Set `SEED_DEMO=0`, then create and open a fresh lot with the curl commands above shortly before the demo. A seeded lot that nobody joins closes as UNSOLD after its 10-minute limit and stays closed on the volume.
5. Keep it to **one instance**: the engine must be the only authority.

The bridge token travels in the WebSocket URL; the engine redacts it (`token=***`) from uvicorn's logs.

## Signatures

`INTENT_SIGNATURES_REQUIRED=1` makes the engine reject any JOIN/LEAVE/BID that isn't signed by the tag's enrolled secp256k1 key. Give each seat a `publicKey` when creating the auction. The message format is in `bid3_engine/intents.py`. It's off by default until the firmware signs intents.
