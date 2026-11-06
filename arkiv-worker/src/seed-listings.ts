/**
 * Writes demo lots to Arkiv as ItemListing entities, so the catalogue has
 * something to show before sellers list from their own wallets.
 *
 *   ARKIV_PRIVATE_KEY=0x... ARKIV_ACCESS_KEY=... npm run seed-listings [-- <lot number>]
 *
 * Lot N is listed as listingId `lot-00N` for auction `bid3-00N` (default N = 3).
 * The engine lot must use the same auctionId and listingId, and an auction ID
 * can only be used once, so each new round needs a new lot number.
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

const lotArg = process.argv[2];
const lotNumber = lotArg === undefined ? 3 : Number(lotArg);
if (!Number.isInteger(lotNumber) || lotNumber < 1 || lotNumber > 999) {
  throw new Error(`Lot number must be a whole number from 1 to 999, got "${lotArg}".`);
}
const pad = (n: number) => String(n).padStart(3, "0");

const LOTS = [
  {
    lotNumber,
    auctionId: `bid3-${pad(lotNumber)}`,
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
        listingId: `lot-${pad(lot.lotNumber)}`,
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
    console.log(
      `listed lot ${lot.lotNumber} (auctionId ${lot.auctionId}, listingId lot-${pad(lot.lotNumber)}) as ${account.address}: entity ${entityKey} (tx ${txHash})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
