import type { Listing } from "./types";

export interface ListingCandidate {
  listing: Listing;
  /** Block the entity was created in, when the reader knows it. */
  createdAtBlock?: bigint;
}

/**
 * Which listing describes an auction. Anyone can write an ItemListing carrying any auctionId, so a
 * plain "first match" lets a stranger's listing replace a lot's title. The rules, in order:
 *
 *  1. If the publisher's AuctionDefinition names a listingId, only listings with that id count.
 *     (If none match, there is no trustworthy listing: return null rather than a wrong title.)
 *  2. A listing whose owner isn't its own sellerAddress is ignored.
 *  3. A listing owned by the Bid3 publisher wallet (the seeded demo lot) wins.
 *  4. Otherwise the first one written wins, so a later copy can't displace the original. The seller
 *     flow gives every listing a fresh random auctionId, so nobody can write a copy first.
 */
export function pickListing(candidates: ListingCandidate[], publisher: string, expectedListingId?: string): Listing | null {
  const owner = publisher.toLowerCase();
  const eligible = candidates.filter(
    ({ listing }) =>
      (expectedListingId === undefined || listing.listingId === expectedListingId) &&
      listing.owner.toLowerCase() === listing.sellerAddress.toLowerCase(),
  );

  const fromPublisher = eligible.filter(({ listing }) => listing.owner.toLowerCase() === owner);
  const pool = fromPublisher.length > 0 ? fromPublisher : eligible;

  const earliest = [...pool].sort((a, b) => {
    const ab = a.createdAtBlock ?? BigInt(Number.MAX_SAFE_INTEGER);
    const bb = b.createdAtBlock ?? BigInt(Number.MAX_SAFE_INTEGER);
    if (ab !== bb) return ab < bb ? -1 : 1;
    return a.listing.key < b.listing.key ? -1 : a.listing.key > b.listing.key ? 1 : 0;
  });
  return earliest[0]?.listing ?? null;
}
