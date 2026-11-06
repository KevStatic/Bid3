# Bid3 Arkiv worker

Drains the engine's outbox into Arkiv entities, written by the Bid3 publisher wallet: the frozen rules, every accepted bid, coalesced snapshots and the result. The live auction never waits on it. If Arkiv is slow, records queue in the engine and the room shows them as pending.

```bash
cd arkiv-worker
npm install
cp .env.example .env        # then fill it in
npm start                   # runs dry (writes nothing) until ARKIV_PRIVATE_KEY is set
```

## Setup

1. Create the publisher wallet:
   ```bash
   node --input-type=module -e "import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'; const k = generatePrivateKey(); console.log(k, privateKeyToAccount(k).address)"
   ```
2. Fund the address at https://hub.arkiv.network/faucet and get an access key at https://hub.arkiv.network/access-keys.
3. Set the following, then `npm start`:
   - `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY`
   - `ENGINE_URL` (e.g. `http://localhost:8010`)
   - `WORKER_TOKEN` (same as the engine's)
4. Put the logged publisher address in the web app's `NEXT_PUBLIC_PUBLISHER_ADDRESS`, so the results page can verify the issuer.
5. Optional: `npm run seed-listings` writes the demo lot to Arkiv so the catalogue has a live entry.

To check what's on Arkiv without the engine or the web app, run `npm run query-results -- <publisher address>`. It needs no key; this is the query the root README gives judges.

## What it writes

| Entity | Flags | Expires | Why |
|---|---|---|---|
| `AuctionDefinition` | read-only | 30 days | Frozen rules; the results page recomputes their hash |
| `AuctionBid` | read-only | 7 days | One per accepted press; the bid history page reads these |
| `AuctionSnapshot` | — | 10 minutes | Room fallback if the live stream drops; stale ones vanish |
| `AuctionResult` | read-only, anyone may extend | 90 days | The record people check; anyone can keep it alive |

Read-only entities can't have their attributes edited by anyone, Bid3 included. The owner can still delete them, which the results page can't prevent.

**Retries:**
- **Order:** each record is retried in order until it succeeds.
- **Already written?** After a failure, the worker first looks for its own entity with the same identity (auction, epoch, bid index), so a write that landed is reused, not duplicated.

`src/schemas.ts` must stay identical to `web/src/lib/arkiv/schemas.ts`; `npm run check-schemas` fails if they drift.

## Deploy (Railway)

1. Second service from the repo, root directory `arkiv-worker`, start command `npm start`.
2. Set the same env vars, with `ENGINE_URL` pointing at the engine's internal or public URL.
