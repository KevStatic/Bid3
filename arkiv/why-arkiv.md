# Why Arkiv

## If we swapped Arkiv for Postgres, what would our users lose?

**1. Checking a result without trusting us.**
- In Postgres, a hammer price is whatever our server says. On Arkiv, the [results page](../web/src/app/explorer/explorer-view.tsx) reads straight from the chain, never from our engine, and runs five checks in the viewer's browser:
  1. The result is owned by our publisher wallet.
  2. The frozen rules hash to the hash the result was closed under.
  3. The bid entities add up to the result's bid count, hammer price and winner.
  4. Every bid sits exactly on the price ladder the rules define, with no gaps and no paddle outbidding itself.
  5. Hashing the bids gives the `transcriptDigest` the result was sealed with.
- Rules, bids and results are written `readonly`, so their contents can't be edited after the fact, by us included.
- Honest limit: as the owner, our wallet could still delete them (see [friction #4](friction.md)). A deletion shows up as missing data, not as a quiet edit.

**2. Sellers own their listing.**
- A listing is written from the seller's own wallet ([seller flow](../web/src/app/seller/seller-flow.tsx)), so the seller is the entity's owner, and we can't edit their title, description or start price.
- In Postgres the row would be ours.

**3. The record outlives our server.**
- The results page, bid history and catalogue keep working with our engine switched off: they only talk to Arkiv.
- Results are created with `permissionlessExtension`, so a buyer, seller or charity can keep a result alive past our 90 days without our help and without being able to change it.

**4. Data that should disappear does.**
- Room snapshots vanish after 10 minutes, bids after 7 days, and listings a day after the auction closes. No cron job and no database to clean, so we never hold bidding history longer than the lot needs.

## What we kept off Arkiv, and why

| Kept off | Where it lives | Why |
|---|---|---|
| **The live bid loop**: ordering presses, the countdown, deciding the winner | The engine (FastAPI + SQLite journal) | A round restarts a 5-second countdown on every bid, so press-to-decision has to be fast and can't depend on a chain write landing. Arkiv receives every accepted bid right after, through an outbox and a worker. The room never waits on Arkiv; if Arkiv is slow, the room shows "N pending". |
| **Refused presses and the operator journal** | Engine SQLite | They're operational: why a press was ignored or stale. The public record is what decided the outcome: the rules, accepted bids and result. |
| **Device identities** (`TAG1`, `TAG2`, radio links) | Engine only | Bidders appear on Arkiv as a fresh alias per round (`K7`, `M4`), never as a device ID, so a paddle can't be tracked across auctions. |
| **Payment** | Not built (demo credits) | We don't move money. Prices are labelled "demo credits". |
| **Secrets** (publisher key, operator and bridge tokens) | Worker and engine environment | The publisher key only signs writes from the worker. The browser holds only the Arkiv access key, which the SDK documents as not secret. |

> **TODO (Kev):** once live, add one measured number here, for example "a bid becomes an Arkiv entity N seconds after the press (median of M bids)". The worker logs both timestamps.
