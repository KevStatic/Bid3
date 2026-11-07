/**
 * Server side of "Sell an item" (app/api/list): checks the seller's signature over listingMessage(), then
 * asks the engine (operator token, server only) to queue the listing. The Arkiv worker writes it with
 * the publisher wallet and makes the seller its owner, so sellers never need Rabdi or tGLM.
 */
import { isAddress, verifyMessage, type Hex } from "viem";
import { AdminError, engine } from "@/lib/admin/server";
import { LISTING_MAX_AGE_MS, listingMessage, type ListingFields } from "@/lib/listing-shared";

const ID = /^[A-Za-z0-9._-]{1,64}$/;

const str = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== "string" || v.trim().length < min || v.length > max) throw new AdminError(400, `Check the ${what}.`);
  return v;
};
const int = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new AdminError(400, `Check the ${what}.`);
  return v;
};

export async function submitListing(body: unknown): Promise<{ listingId: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const f = (b.listing ?? {}) as Record<string, unknown>;
  const listing: ListingFields = {
    listingId: str(f.listingId, 1, 64, "listing id"),
    auctionId: str(f.auctionId, 1, 64, "auction id"),
    lotNumber: int(f.lotNumber, 1, 1_000_000, "lot number"),
    title: str(f.title, 3, 120, "title"),
    category: str(f.category, 1, 40, "category"),
    condition: str(f.condition, 1, 200, "condition"),
    description: typeof f.description === "string" ? str(f.description, 0, 2_000, "description") : "",
    sellerAlias: str(f.sellerAlias, 1, 40, "seller name"),
    startPriceMinor: int(f.startPriceMinor, 1, 1_000_000_000, "opening bid"),
    closesAtMs: int(f.closesAtMs, Date.now(), Date.now() + 60 * 24 * 60 * 60 * 1000, "listing period"),
  };
  if (!ID.test(listing.listingId) || !ID.test(listing.auctionId)) throw new AdminError(400, "Check the listing id.");
  const { seller, signature, issuedAtMs } = b;
  if (typeof seller !== "string" || !isAddress(seller)) throw new AdminError(400, "That isn't a wallet address.");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130,520}$/.test(signature)) throw new AdminError(400, "The signature is missing.");
  if (typeof issuedAtMs !== "number" || Math.abs(Date.now() - issuedAtMs) > LISTING_MAX_AGE_MS) {
    throw new AdminError(400, "That signature is too old. Publish again.");
  }
  const valid = await verifyMessage({ address: seller, message: listingMessage(listing, seller, issuedAtMs), signature: signature as Hex }).catch(() => false);
  if (!valid) throw new AdminError(400, "The signature doesn't match this wallet and listing.");
  await engine("/listings", "POST", { ...listing, sellerAddress: seller.toLowerCase(), signature });
  return { listingId: listing.listingId };
}
