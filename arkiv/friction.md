# Arkiv feedback

What got in our way building Bid3 on Arkiv (Rabdi testnet, `@arkiv-network/sdk`), and what we'd want next. Each entry says what we expected, what happened, how to reproduce it, and what we did instead.

> **TODO (Kev):** add entries from going live tonight: wallet funding, the faucet, the first write, write latency, anything in the explorer. Those are the most useful ones, and they aren't here yet because nothing has been written to testnet from this repo so far.

---

### 1. Entities in your schema's shape can come from any wallet, and queries return them by default

*Fri 6 Nov, afternoon. Found in code review of our readers; not yet reproduced on testnet.*

- **Expected:** `client.select().from(AuctionBid).where(eq("auctionId", …))` returns our app's bids.
- **Actual:** it returns every entity tagged `bid3.bid` with that `auctionId`, from any wallet. One look-alike bid from a stranger was enough to make our results page report "Bids don't add up". One look-alike listing could replace the title of the live lot.
- **Reproduce:** from a second wallet, `createEntity(AuctionBid, {...same auctionId...})`, then run the query above without `.ownedBy(...)`.
- **What we did:**
  - Every read of data only Bid3 writes (rules, bids, snapshots, results) now has `.ownedBy(publisher)` ([`web/src/lib/arkiv/live-reader.ts`](../web/src/lib/arkiv/live-reader.ts)).
  - Listings are written by sellers' own wallets, so there's no single owner to pin. We wrote our own rules for picking the real listing ([`pick-listing.ts`](../web/src/lib/arkiv/pick-listing.ts)), and the seller flow now gives every listing a random, unguessable `auctionId`.
- **Would help:**
  - A loud note in the docs that schema tags are not namespaces and should usually be paired with `ownedBy`.
  - Longer term, a way to say "only these wallets may write `bid3.*`", or a uniqueness rule such as "one `bid3.listing` per `auctionId`, first writer wins".

### 2. `$createdAt` can be read but not sorted or filtered on

*Fri 6 Nov, afternoon.*

- **Expected:** to pick the original listing over later copies, sort by creation: `.orderBy(asc("$createdAt"))`.
- **Actual:** a type error. In the SDK's words: `"$createdAt" cannot be sorted on. The sortable system attributes are $key, $owner, $creator and $expiresAt`. The docs also say `$createdAt` "is not indexed, so it cannot appear in a predicate".
- **Reproduce:** `client.select().from(AnySchema).orderBy(asc("$createdAt"))` in TypeScript.
- **What we did:** fetch up to 50 candidates and sort them by `$createdAt` in the browser. This silently breaks past 50 look-alikes.
- **Would help:** make `$createdAt` sortable, or at least sortable within a filtered set.

### 3. No idempotent create, so a retry after a timeout can duplicate an entity

*Fri 6 Nov. Built at ~09:30, and re-read at ~18:30 when we found `predictEntityKeys`.*

- **Context:** our worker writes each accepted bid once. If a create times out, it can't tell whether the write landed.
- **Expected:** a create we can safely repeat, for example one keyed by `(owner, salt)`.
- **Actual:**
  - `predictEntityKeys` exists. We missed it at first: our worker's comment still says keys "can't be fixed in advance".
  - Per its docs, though, the key is `keccak256(chainId ++ registry ++ owner ++ nonce ++ salt)`, and the prediction holds "only while nothing else from this owner is in flight".
  - A retry after a timeout runs at a new nonce, so the same salt gives a new key. Prediction doesn't make retries idempotent.
- **What we did:** before any retry, the worker queries for its own entity with the same logical identity (`auctionId`, `epoch`, `bidIndex`, `.ownedBy(owner)`) and reuses it if found ([`arkiv-worker/src/writer.ts`](../arkiv-worker/src/writer.ts), `existing()`).
- **Would help:**
  - A create that's a no-op when the same `(owner, salt)` already exists.
  - Or a docs recipe for idempotent writers.

### 4. `readonly` doesn't mean "kept": the owner can still delete it

*Fri 6 Nov, evening, while writing [`why-arkiv.md`](why-arkiv.md).*

- **Expected:** `flags: { readonly: true }` on a result would make it a record that stays until it expires.
- **Actual:** the SDK says a read-only entity's attributes can never change, but it can still be "extended, its ownership transferred, and the entity deleted". So our own publisher wallet could delete an auction result. Verifiers would see it missing, not proof that we removed it.
- **What we did:** we say so plainly, rather than calling results permanent. Bid entities and the transcript digest at least make any edit detectable while they exist.
- **Would help:** a creation flag such as "no delete before expiry", for entities meant as public evidence. Ours are auction results, but receipts and votes have the same need.

### 5. The explorer link format for an entity isn't documented

*Fri 6 Nov, ~08:50, building the web app.*

- **Expected:** a documented URL to link from our pages to an entity in the explorer.
- **Actual:** we guessed `https://rabdi.explorer.arkiv.network/entity/<key>` ([`web/src/lib/config.ts`](../web/src/lib/config.ts), `explorerEntityUrl`).
- **Status:** **TODO (Kev):** confirm or correct it once we have a live entity, and note the result here.
- **Would help:** one line in the docs with the explorer's deep-link format for entities and transactions.

### 6. What worked well

- **Schemas.** `defineSchema` with `.indexed()` gave us typed reads and writes. One schema file is shared, byte for byte, by the web app and the worker, and a script fails the build if they drift.
- **Queries.** The query builder reads like the question we're asking, so we show each page's exact query to users with a copy button.
- **Flags.** `readonly` and `permissionlessExtension` mapped exactly onto "frozen rules" and "anyone can keep a result alive".
- **Expiry.** Per-entity expiry let us retire short-lived data (10-minute snapshots) without writing any cleanup code.
