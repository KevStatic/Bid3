import { addr, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

/**
 * Bid3's six Arkiv entity types.
 *
 * This file is the single source of truth for /arkiv/schema.md and is meant
 * to be imported by the Arkiv worker too, so reads and writes can never drift.
 * Only `.indexed()` columns can be filtered on; each one exists because a page
 * filters or sorts by it.
 *
 * Owners and expiry (enforced by whoever writes):
 *   ItemListing        seller's own wallet       closesAt + 24 h
 *   AuctionDefinition  Bid3 publisher wallet     until the result expires
 *   AuctionBid         Bid3 publisher wallet     closesAt + 7 days
 *   AuctionSnapshot    Bid3 publisher wallet     ~10 minutes
 *   AuctionResult      Bid3 publisher wallet     long, renewed
 *   AuctionSettlement  Bid3 publisher wallet     long, like the result
 */

/** Catalogue page: filter by category, status, start price; sort by closing time. */
export const ItemListing = defineSchema("bid3.listing", {
  listingId: str().indexed(),
  lotNumber: u64().indexed(),
  category: str().indexed(),
  status: str().indexed(), // UPCOMING | OPEN | CLOSED
  startPriceMinor: u64().indexed(),
  closesAtMs: u64().indexed(),
  auctionId: str().indexed(),
  sellerAlias: str(),
  sellerAddress: addr(),
  title: str(),
  description: str(),
  condition: str(),
  imageUrl: str().optional(),
});

/** Frozen rules. The results explorer recomputes rulesHash from these fields. */
export const AuctionDefinition = defineSchema("bid3.definition", {
  auctionId: str().indexed(),
  epoch: u64().indexed(),
  listingId: str().indexed(),
  rulesHash: str().indexed(),
  startPriceMinor: u64(),
  stepBps: u64(),
  countdownMs: u64(),
  ceilingMinor: u64(),
  timeLimitMs: u64(),
  unit: str(),
});

/** Bid history page: one entity per accepted bid. */
export const AuctionBid = defineSchema("bid3.bid", {
  auctionId: str().indexed(),
  epoch: u64().indexed(),
  bidIndex: u64().indexed(),
  priceMinor: u64().indexed(),
  bidderAlias: str().indexed(),
  serverSeq: u64(),
  acceptedAtMs: u64(),
});

/** Room page fallback when the live stream drops. Short-lived on purpose. */
export const AuctionSnapshot = defineSchema("bid3.snapshot", {
  auctionId: str().indexed(),
  serverSeq: u64().indexed(),
  phase: str().indexed(),
  priceMinor: u64(),
  leaderAlias: str().optional(),
  activeCount: u64(),
  generatedAtMs: u64(),
});

/** Results explorer: filter by category and status, sort by hammer price or close time. */
export const AuctionResult = defineSchema("bid3.result", {
  auctionId: str().indexed(),
  epoch: u64().indexed(),
  listingId: str().indexed(),
  category: str().indexed(),
  status: str().indexed(), // SOLD | UNSOLD | CANCELLED
  hammerPriceMinor: u64().indexed(),
  closedAtMs: u64().indexed(),
  winnerAlias: str(),
  finalSeq: u64(),
  bidCount: u64(),
  rulesHash: str(),
  transcriptDigest: str(),
});

/**
 * The payment for a sold lot, made on Sepolia from the winning paddle's linked wallet to the seller.
 * PAID carries the Sepolia transaction; UNPAID means the lot stayed with the seller, with the reason.
 * Addresses are plain strings because an UNPAID lot may have no payer.
 */
export const AuctionSettlement = defineSchema("bid3.settlement", {
  auctionId: str().indexed(),
  epoch: u64().indexed(),
  status: str().indexed(), // PAID | UNPAID
  settledAtMs: u64().indexed(),
  winnerAlias: str(),
  payer: str(),
  payee: str(),
  amountWei: str(),
  chainId: u64(),
  txHash: str(),
  reason: str(),
});
