/**
 * Lists the demo catalogue on Arkiv: six different items, each waiting for the auctioneer to open
 * bidding from the website's admin page. Owned by the wallet that runs it (the publisher).
 *
 *   npm run seed-catalogue
 *
 * Safe to run again: an item whose auctionId already has a listing from this wallet is skipped.
 * Item N is listed as listingId `item-N` for auction `bid3-cat-N`. Lot numbers start at 11, so they
 * don't collide with the bid3-00N lots scripts/new-lot.sh creates.
 */
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { addr, str, u64 } from "@arkiv-network/sdk/schema";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { ItemListing } from "./schemas.ts";

const DAY = 24 * 60 * 60 * 1000;
/** Listings stay on Arkiv a week, well past judging. */
const LISTED_FOR_MS = 7 * DAY;

const ITEMS = [
  {
    lotNumber: 11,
    title: "Polaroid SX-70 folding camera",
    category: "Cameras",
    condition: "Tested, new bellows",
    description: "The 1972 folding instant SLR. Fires, focuses and ejects cleanly. Film not included.",
    startPriceMinor: 150_00,
  },
  {
    lotNumber: 12,
    title: "HMT Janata wristwatch, 1978",
    category: "Watches",
    condition: "Serviced, original dial",
    description: "Hand-wound HMT Janata with its original dial and crown. Keeps time to within a minute a day.",
    startPriceMinor: 80_00,
  },
  {
    lotNumber: 13,
    title: "Yamaha FG-180 acoustic guitar",
    category: "Music",
    condition: "Played, new strings",
    description: "1970s red-label FG-180 with a warm, full low end. Comes with a hard case.",
    startPriceMinor: 200_00,
  },
  {
    lotNumber: 14,
    title: "Hand-block-printed Bagru cotton throw",
    category: "Textiles",
    condition: "New, hand-washed once",
    description: "Indigo and madder block print from Bagru, Rajasthan. 150 × 220 cm, natural dyes.",
    startPriceMinor: 60_00,
  },
  {
    lotNumber: 15,
    title: "Hand-wired split keyboard, 42 keys",
    category: "Electronics",
    condition: "Built this week",
    description: "Choc low-profile switches, wireless halves, walnut case. Firmware open source.",
    startPriceMinor: 100_00,
  },
  {
    lotNumber: 16,
    title: "Brass Ganesha lamp, hand-cast",
    category: "Craft",
    condition: "Polished, minor patina",
    description: "Five-wick diya cast in Moradabad brass, 30 cm tall. Signed on the base by the maker.",
    startPriceMinor: 120_00,
  },
];

async function main() {
  if (!config.privateKey) throw new Error("Set ARKIV_PRIVATE_KEY to the wallet that should own the catalogue (the publisher).");
  const account = privateKeyToAccount(config.privateKey);
  const chain = rabdi({ accessKey: config.accessKey });
  const reader = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ chain, transport: http(), account });

  for (const item of ITEMS) {
    const auctionId = `bid3-cat-${item.lotNumber}`;
    const listingId = `item-${item.lotNumber}`;
    const existing = await reader.select().from(ItemListing).ownedBy(account.address).where(eq("auctionId", str(auctionId))).limit(1).fetch();
    if (existing.entities.length > 0) {
      console.log(`lot ${item.lotNumber} ${item.title}: already listed (${existing.entities[0].$key}), skipped`);
      continue;
    }
    const closesAtMs = Date.now() + LISTED_FOR_MS;
    const { entityKey } = await wallet.createEntity(
      ItemListing,
      {
        listingId,
        lotNumber: u64(item.lotNumber),
        category: item.category,
        status: "UPCOMING",
        startPriceMinor: u64(item.startPriceMinor),
        closesAtMs: u64(closesAtMs),
        auctionId,
        sellerAlias: "Bid3 demo seller",
        sellerAddress: addr(account.address),
        title: item.title,
        description: item.description,
        condition: item.condition,
      },
      { expiration: ExpirationTime.atDate(new Date(closesAtMs + DAY)) },
    );
    console.log(`lot ${item.lotNumber} ${item.title}: listed as ${auctionId} / ${listingId}, entity ${entityKey}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
