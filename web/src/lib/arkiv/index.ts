import { config } from "../config";
import type { ArkivReader } from "./types";

export * from "./types";

let reader: Promise<ArkivReader> | null = null;

/**
 * The Arkiv reader for this build. The live reader (and the SDK) is only
 * loaded when NEXT_PUBLIC_ARKIV_MODE=live, keeping sample builds light.
 */
export function getArkivReader(): Promise<ArkivReader> {
  reader ??=
    config.arkivMode === "live"
      ? import("./live-reader").then((m) => new m.LiveArkivReader())
      : import("./sample-reader").then((m) => new m.SampleArkivReader());
  return reader;
}

/** The Arkiv query a judge can paste, shown on each Arkiv-backed page. */
export const QUERY_SNIPPETS = {
  catalogue: `client.select().from(ItemListing)
  .where(and(eq("status", str("OPEN")), eq("category", str("Electronics"))))
  .orderBy(asc("closesAtMs")).limit(100).fetch()`,
  bids: (auctionId: string) => `client.select().from(AuctionBid)
  .where(eq("auctionId", str("${auctionId}")))
  .orderBy(desc("bidIndex")).limit(100).fetch()`,
  results: `client.select().from(AuctionResult)
  .orderBy(desc("closedAtMs")).limit(100).fetch()`,
};
