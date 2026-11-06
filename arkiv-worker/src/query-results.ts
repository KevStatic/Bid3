/**
 * The query judges can run: Bid3's auction results, read straight from Arkiv, without our server.
 *
 *   cd arkiv-worker && npm install
 *   npm run query-results -- 0xPublisherAddress     only results written by the Bid3 publisher
 *   npm run query-results                           every bid3.result entity, look-alikes included
 *
 * Needs no key. ARKIV_ACCESS_KEY is optional: without it the public endpoint is used, which is
 * rate limited. The same query, as code:
 *
 *   client.select().from(AuctionResult).ownedBy(publisher).orderBy(desc("closedAtMs")).limit(20).fetch()
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc } from "@arkiv-network/sdk/query";
import { http, isAddress } from "viem";
import { AuctionResult } from "./schemas.ts";

const publisher = process.argv[2];
if (publisher !== undefined && !isAddress(publisher)) {
  console.error(`Not an address: ${publisher}`);
  process.exit(1);
}

const client = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http() });

let query = client.select().from(AuctionResult);
if (publisher) query = query.ownedBy(publisher);
const page = await query.orderBy(desc("closedAtMs")).limit(20).fetch();

console.log(publisher ? `AuctionResult entities owned by ${publisher}:` : "AuctionResult entities from any wallet (pass the publisher address to filter):");
if (page.entities.length === 0) console.log("  none found");
for (const e of page.entities) {
  const sold = e.status.value === "SOLD";
  console.log(
    [
      `  ${e.auctionId.value}`,
      e.status.value,
      sold ? `Paddle ${e.winnerAlias.value} at ${(Number(e.hammerPriceMinor.value) / 100).toFixed(2)}` : "-",
      `${e.bidCount.value} bids`,
      new Date(Number(e.closedAtMs.value)).toISOString(),
      `entity ${e.$key}`,
      `owner ${e.$owner}`,
    ].join(" | "),
  );
}
