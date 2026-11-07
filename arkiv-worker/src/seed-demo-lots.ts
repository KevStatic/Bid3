/**
 * Lists 20 more demo items on Arkiv (lots 21-40), each waiting for the auctioneer to open bidding
 * from the website's admin page. Owned by the wallet that runs it (the publisher).
 *
 *   npm run seed-demo-lots
 *
 * Safe to run again: an item whose auctionId already has a listing from this wallet is skipped.
 * Item N is listed as listingId `item-N` for auction `bid3-demo-N`.
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
  { lotNumber: 21, title: "Sony Walkman WM-EX10 cassette player", category: "Electronics", condition: "Works, new belt", description: "Pocket cassette player from 1995 with its belt clip. Plays and rewinds smoothly.", startPriceMinor: 90_00 },
  { lotNumber: 22, title: "Titan Edge slim watch, steel", category: "Watches", condition: "Light scratches on the strap", description: "One of the slimmest quartz watches made. Fresh battery, keeps good time.", startPriceMinor: 120_00 },
  { lotNumber: 23, title: "Canon AE-1 Program with 50 mm f/1.8", category: "Cameras", condition: "Tested with a roll of film", description: "Classic 35 mm SLR with the standard lens. Light meter and shutter speeds check out.", startPriceMinor: 180_00 },
  { lotNumber: 24, title: "Kanjeevaram silk stole, temple border", category: "Textiles", condition: "Unworn", description: "Handwoven Kanchipuram silk in deep maroon with a gold temple border.", startPriceMinor: 140_00 },
  { lotNumber: 25, title: "Channapatna wooden toy train", category: "Craft", condition: "New", description: "Lacquered wooden train from Channapatna, coloured with vegetable dyes. Five carriages.", startPriceMinor: 35_00 },
  { lotNumber: 26, title: "Casio CT-S1 keyboard, 61 keys", category: "Music", condition: "Like new, with stand", description: "Portable keyboard with touch-sensitive keys and built-in speakers.", startPriceMinor: 160_00 },
  { lotNumber: 27, title: "Mumbai local train ticket set, 1980s", category: "Collectibles", condition: "Good, slight fading", description: "Twelve cardboard Edmondson tickets from Western Railway suburban stations.", startPriceMinor: 25_00 },
  { lotNumber: 28, title: "Raspberry Pi 4, 4 GB, with case", category: "Electronics", condition: "Used, fully working", description: "Runs Raspberry Pi OS from the included 32 GB card. Fan case and power supply included.", startPriceMinor: 70_00 },
  { lotNumber: 29, title: "Ajanta pendulum wall clock", category: "Collectibles", condition: "Restored, chimes on the hour", description: "Wooden pendulum clock with brass weights. Wound and keeping time.", startPriceMinor: 65_00 },
  { lotNumber: 30, title: "Bidriware vase, silver inlay", category: "Craft", condition: "New", description: "Hand-made in Bidar: blackened zinc alloy with fine silver inlay. 20 cm tall.", startPriceMinor: 110_00 },
  { lotNumber: 31, title: "Yamaha HS5 studio monitor (single)", category: "Music", condition: "Works, minor scuffs", description: "Five-inch powered studio monitor. Flat, clear sound; power cable included.", startPriceMinor: 130_00 },
  { lotNumber: 32, title: "Pashmina shawl, natural undyed", category: "Textiles", condition: "New, with certificate", description: "Hand-spun, hand-woven pashmina from Srinagar in its natural oatmeal colour.", startPriceMinor: 200_00 },
  { lotNumber: 33, title: "Mechanical keyboard switch tester, 36 switches", category: "Electronics", condition: "New", description: "Acrylic tester with 36 different switches, from linear to clicky.", startPriceMinor: 20_00 },
  { lotNumber: 34, title: "Olympus Trip 35 film camera", category: "Cameras", condition: "Tested, selenium meter works", description: "The pocket rangefinder that needs no batteries. Sharp Zuiko 40 mm lens.", startPriceMinor: 95_00 },
  { lotNumber: 35, title: "Warli painting on canvas, A3", category: "Craft", condition: "New, unframed", description: "Hand-painted Warli scene of a harvest dance, white on terracotta.", startPriceMinor: 45_00 },
  { lotNumber: 36, title: "Favre-Leuba hand-wound watch, 1960s", category: "Watches", condition: "Serviced last year", description: "Gold-tone case, cream dial, hand-wound movement. A classic Indian favourite.", startPriceMinor: 250_00 },
  { lotNumber: 37, title: "Steel tabla pair, dayan and bayan", category: "Music", condition: "Tuned, new straps", description: "Professional pair with a copper bayan and a sheesham dayan. Includes cushions.", startPriceMinor: 150_00 },
  { lotNumber: 38, title: "Vintage Campa Cola glass bottle", category: "Collectibles", condition: "Good, label intact", description: "Original 1980s Campa Cola bottle from before the brand's return.", startPriceMinor: 30_00 },
  { lotNumber: 39, title: "Kindle Paperwhite, 11th generation", category: "Electronics", condition: "Like new", description: "Warm light, waterproof, 8 GB. Reset and ready for a new account.", startPriceMinor: 85_00 },
  { lotNumber: 40, title: "Kolhapuri chappals, hand-stitched", category: "Other", condition: "New, size 9", description: "Vegetable-tanned leather, stitched by hand in Kolhapur.", startPriceMinor: 40_00 },
];

async function main() {
  if (!config.privateKey) throw new Error("Set ARKIV_PRIVATE_KEY to the wallet that should own the catalogue (the publisher).");
  const account = privateKeyToAccount(config.privateKey);
  const chain = rabdi({ accessKey: config.accessKey });
  const reader = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ chain, transport: http(), account });

  for (const item of ITEMS) {
    const auctionId = `bid3-demo-${item.lotNumber}`;
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
