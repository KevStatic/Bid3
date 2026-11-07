# How we use Arkiv

Five entity types on the Rabdi testnet; the full field list is in [`schema.md`](schema.md). This file answers the two judging questions directly.

## Do the things we filter on, who can edit each entity, and when it expires fit what the app does?

| Entity | We filter / sort on | Because | Who can edit | Expires | Because |
|---|---|---|---|---|---|
| `ItemListing` | `category`, `status`, `startPriceMinor`, sort `closesAtMs`; `auctionId` | The [catalogue](../web/src/app/catalogue/catalogue-view.tsx) has exactly these filters and sorts; the room and seat pages find their lot by `auctionId` | **The seller's wallet only** (we can't) | Close + 24 h | Buyers can review a lot for a day after the hammer, then it's gone |
| `AuctionDefinition` | `auctionId`, `epoch` | The results page fetches the rules behind a result | Nobody: `readonly` | 30 days | Outlives the bids it prices |
| `AuctionBid` | `auctionId`, sort `bidIndex` (+ `epoch` for the worker's duplicate check) | [Bid history](../web/src/app/auction/[id]/bids/bids-view.tsx) lists a lot's bids in order; the results page reprices them | Nobody: `readonly` | 7 days | Long enough to dispute a result; we don't keep bidding history longer |
| `AuctionSnapshot` | `auctionId`, sort `serverSeq` | The [room](../web/src/app/room/[auctionId]/room-view.tsx) shows the newest one if the live stream drops | Our publisher wallet | 10 minutes | A snapshot is only useful while the round is running |
| `AuctionResult` | sort `closedAtMs` | The [results page](../web/src/app/explorer/explorer-view.tsx) lists newest first | Nobody: `readonly`; **anyone may extend** | 90 days, extendable by anyone | The record people check; whoever cares can keep it alive |

Every read of publisher-written data is pinned with `.ownedBy(publisher)`, so look-alike entities from other wallets are ignored (see [friction #1](friction.md)).

## Does each Arkiv feature we use change something users see?

| Arkiv feature | What the user sees |
|---|---|
| **Indexed attributes + `where` / `orderBy`** | Catalogue filters (category, status, price range) and sorting by closing time, answered by Arkiv. The Lots, Bid history and Results pages show the exact query they ran, with a copy button. |
| **Entities owned by the seller's wallet** | The seller signs the listing in their own wallet (free, on any network). Bid3 pays for the Arkiv write and then transfers ownership to the seller, so the seller needs no tGLM. The page links the new entity and says "owned by your wallet". |
| **`ownedBy` on reads** | The results page says "Published by Bid3" or flags "Unverified issuer" (the sample data includes an impostor result to show this). The live lot's title can't be replaced by someone else's listing. |
| **`readonly` flag** | The results page's "Rules match", "Every bid on the ladder" and "Transcript matches" checks mean something, because the rules and bids they check can't have been edited. |
| **Expiry** | When the live stream drops, the room shows the last public snapshot on Arkiv (price and leading paddle). Snapshots older than 10 minutes are simply gone, so it never shows a stale round. Listings drop out of the catalogue a day after closing. |
| **`$owner`, `$createdAt`** | When several listings claim the same lot, users see the seller's original, not a later copy. |
| **`permissionlessExtension`** | **Not visible yet.** Results are written with it, but there's no "keep this result longer" button. **TODO (Kev):** build it or cut this line. |

### Every user-facing read, by page

| Page | Reads from Arkiv |
|---|---|
| Home | Live lot's listing; recent results |
| Lots (catalogue) | `ItemListing` with the chosen filters |
| Live room | The lot's listing; the latest `AuctionSnapshot` when the stream drops |
| Bid history | `AuctionBid` for the lot |
| Results | `AuctionResult`, plus each one's `AuctionDefinition` and `AuctionBid` for the five browser checks |
| Seat page (NFC) | The lot's listing |

Writes come from two places:
- **The publisher wallet**, through the [worker](../arkiv-worker/src/writer.ts): rules, bids, snapshots and results.
- **The seller's own wallet**, from the [seller flow](../web/src/lib/arkiv/write-listing.ts): listings. The seller signs; the publisher creates the entity and transfers it to them (`arkiv-worker/src/writer.ts`).
