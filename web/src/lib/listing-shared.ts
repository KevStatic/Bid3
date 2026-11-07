/**
 * Selling without Rabdi: the seller signs this text with their wallet (free, any network, e.g. Sepolia).
 * The site checks the signature and the Bid3 publisher writes the ItemListing to Arkiv, then makes the
 * seller's wallet its owner. The server rebuilds the same text from the submitted fields to check it.
 */

export interface ListingFields {
  listingId: string;
  auctionId: string;
  lotNumber: number;
  title: string;
  category: string;
  condition: string;
  description: string;
  sellerAlias: string;
  startPriceMinor: number;
  closesAtMs: number;
}

/** A signed listing is accepted for this long after it was made. */
export const LISTING_MAX_AGE_MS = 10 * 60 * 1000;

export function listingMessage(f: ListingFields, seller: string, issuedAtMs: number): string {
  return [
    "Bid3: list this item for auction.",
    "Bid3 writes it to Arkiv and makes this wallet its owner.",
    "",
    `Title: ${f.title}`,
    `Category: ${f.category}`,
    `Condition: ${f.condition}`,
    `Opening bid: ${(f.startPriceMinor / 100).toFixed(2)} credits`,
    `Description: ${f.description || "(none)"}`,
    `Lot ${f.lotNumber}: ${f.listingId} / ${f.auctionId}`,
    `Listed until: ${new Date(f.closesAtMs).toISOString()}`,
    `Seller: ${f.sellerAlias}, ${seller.toLowerCase()}`,
    `Issued: ${issuedAtMs}`,
  ].join("\n");
}
