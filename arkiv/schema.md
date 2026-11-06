# Bid3 on Arkiv: schema

Bid3 keeps five entity types on Arkiv (Rabdi testnet, chain 7794095). They are defined once in `web/src/lib/arkiv/schemas.ts`. The Arkiv worker uses an identical copy, checked by `npm run check-schemas`, so reads and writes can't drift.

Only `.indexed()` attributes can be filtered on. Each indexed attribute below exists because a page filters or sorts by it.

| Entity (schema name) | Owner | Expires | Flags |
|---|---|---|---|
| `ItemListing` (`bid3.listing`) | **The seller's own wallet** | Auction close + 24 h | none (seller may edit before the round opens) |
| `AuctionDefinition` (`bid3.definition`) | Bid3 publisher wallet | 30 days | read-only |
| `AuctionBid` (`bid3.bid`) | Bid3 publisher wallet | 7 days | read-only |
| `AuctionSnapshot` (`bid3.snapshot`) | Bid3 publisher wallet | 10 minutes | none |
| `AuctionResult` (`bid3.result`) | Bid3 publisher wallet | 90 days | read-only, anyone may extend |

## ItemListing

| Attribute | Type | Indexed | Used by |
|---|---|---|---|
| listingId | str | yes | links results and bids back to the lot |
| lotNumber | u64 | yes | catalogue sort by lot |
| category | str | yes | catalogue category filter |
| status | str (`UPCOMING`, `OPEN`, `CLOSED`) | yes | catalogue status filter |
| startPriceMinor | u64 | yes | catalogue price range filter |
| closesAtMs | u64 | yes | catalogue sort by closing time |
| auctionId | str | yes | room and bid-history pages find their lot |
| sellerAlias | str | | shown on the lot |
| sellerAddress | addr | | shown on the lot |
| title, description, condition | str | | shown on the lot |
| imageUrl | str, optional | | shown on the lot |

## AuctionDefinition

| Attribute | Type | Indexed | Used by |
|---|---|---|---|
| auctionId | str | yes | results page fetches the rules for a result |
| epoch | u64 | yes | picks the right round |
| listingId | str | yes | |
| rulesHash | str | yes | results page compares it with the hash it recomputes |
| startPriceMinor, stepBps, countdownMs, ceilingMinor, timeLimitMs | u64 | | the frozen rules; their hash is recomputed in the browser |
| unit | str | | |

The rules hash is sha256 over canonical JSON of `auctionId, epoch, listingId, startPriceMinor, stepBps, countdownMs, ceilingMinor, timeLimitMs, unit`, in that key order with no whitespace. Implemented identically in `web/src/lib/rules-hash.ts` and `engine/bid3_engine/rules_hash.py`.

## AuctionBid

| Attribute | Type | Indexed | Used by |
|---|---|---|---|
| auctionId | str | yes | bid-history page |
| epoch | u64 | yes | |
| bidIndex | u64 | yes | bid-history sort; the worker's duplicate check |
| priceMinor | u64 | yes | |
| bidderAlias | str | yes | per-round paddle alias, never a device ID |
| serverSeq | u64 | | engine ordering |
| acceptedAtMs | u64 | | shown on the bid history |

## AuctionSnapshot

| Attribute | Type | Indexed | Used by |
|---|---|---|---|
| auctionId | str | yes | room page fallback when the live stream drops |
| serverSeq | u64 | yes | newest snapshot first |
| phase | str | yes | |
| priceMinor | u64 | | |
| leaderAlias | str, optional | | |
| activeCount | u64 | | |
| generatedAtMs | u64 | | shown as the snapshot's age |

## AuctionResult

| Attribute | Type | Indexed | Used by |
|---|---|---|---|
| auctionId | str | yes | results page, bid-history outcome |
| epoch | u64 | yes | |
| listingId | str | yes | |
| category | str | yes | results filter |
| status | str (`SOLD`, `UNSOLD`, `CANCELLED`) | yes | results filter |
| hammerPriceMinor | u64 | yes | sort by price |
| closedAtMs | u64 | yes | results sort, newest first |
| winnerAlias | str | | |
| finalSeq | u64 | | |
| bidCount | u64 | | results page checks it against the AuctionBid entities |
| rulesHash | str | | results page checks it against the definition |
| transcriptDigest | str | | sha256 over the accepted bids (oldest first, compact JSON, sorted keys) |

## Example query

```ts
client.select().from(AuctionResult).orderBy(desc("closedAtMs")).limit(100).fetch()
```

Writer wallet addresses: _fill in the publisher address and the demo seller address after setup._
