/**
 * Writes demo lots to Arkiv as ItemListing entities, so the catalogue has
 * something to show before sellers list from their own wallets.
 *
 *   ARKIV_PRIVATE_KEY=0x... ARKIV_ACCESS_KEY=... npm run seed-listings
 *
 * These are owned by whichever wallet runs the script (sellerAlias says who
 * the seller is). Real sellers list from the web app with their own wallet.
 */
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { ItemListing } from "./schemas.ts";

const HOUR = 60 * 60 * 1000;

const LOTS = [
  {
    lotNumber: 3,
    auctionId: "bid3-003",
    title: "Hand-wired split keyboard, 42 keys",
    category: "Electronics",
    condition: "Built this week",
    description: "Choc low-profile switches, wireless halves, walnut case. Firmware open source.",
    startPriceMinor: 10_000,
    status: "OPEN",
    closesInMs: 2 * HOUR,
  },
];

async function main() {
  if (!config.privateKey) throw new Error("Set ARKIV_PRIVATE_KEY to the wallet that should own the demo listings.");
  const account = privateKeyToAccount(config.privateKey);
  const wallet = createWalletClient({ chain: rabdi({ accessKey: config.accessKey }), transport: http(), account });

  for (const lot of LOTS) {
    const closesAtMs = Date.now() + lot.closesInMs;
    const { entityKey, txHash } = await wallet.createEntity(
      ItemListing,
      {
        listingId: `lot-${String(lot.lotNumber).padStart(3, "0")}`,
        lotNumber: u64(lot.lotNumber),
        category: lot.category,
        status: lot.status,
        startPriceMinor: u64(lot.startPriceMinor),
        closesAtMs: u64(closesAtMs),
        auctionId: lot.auctionId,
        sellerAlias: "Bid3 demo seller",
        sellerAddress: addr(account.address),
        title: lot.title,
        description: lot.description,
        condition: lot.condition,
      },
      { expiration: ExpirationTime.atDate(new Date(closesAtMs + 24 * HOUR)) },
    );
    console.log(`listed lot ${lot.lotNumber}: entity ${entityKey} (tx ${txHash})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
