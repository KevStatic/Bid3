import { config } from "../config";
import { priceAtBid } from "../pricing";
import { rulesHash } from "../rules-hash";
import type { BidRecord, Definition, Listing, Result, Snapshot } from "./types";

/**
 * Bundled sample entities, shaped exactly like the Arkiv reads.
 * Every page that shows these labels them "Sample data".
 */

const PUBLISHER = config.publisherAddress;
const IMPOSTOR = "0x9e11a7000000000000000000000000000000c0de";

const SELLERS = {
  meera: { alias: "Meera's Shelf", address: "0x4a1f6c0b9d2e3a7f5c8b1d0e9f2a3b4c5d6e7f80" },
  rohan: { alias: "Rohan Repairs", address: "0x7b2e9d1c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b81" },
  studio: { alias: "Studio Bandra", address: "0x2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c82" },
};

type Seed = {
  lot: number;
  title: string;
  category: string;
  condition: string;
  description: string;
  seller: keyof typeof SELLERS;
  status: Listing["status"];
  closesInMin: number;
  startPriceMinor: number;
  stepBps: number;
  outcome?: { kind: "SOLD"; bids: number; winner: string; impostor?: boolean } | { kind: "UNSOLD" };
};

const SEEDS: Seed[] = [
  {
    lot: 1,
    title: "HMT Janata wristwatch, 1978",
    category: "Watches",
    condition: "Serviced, keeps time",
    description: "Hand-wound, original dial with light patina. New leather strap included.",
    seller: "rohan",
    status: "CLOSED",
    closesInMin: -190,
    startPriceMinor: 8_000,
    stepBps: 500,
    outcome: { kind: "SOLD", bids: 7, winner: "Q2" },
  },
  {
    lot: 2,
    title: "Polaroid SX-70 folding camera",
    category: "Cameras",
    condition: "Tested with fresh film",
    description: "Leather skins intact, bellows light-tight. Ships with one sample print.",
    seller: "studio",
    status: "CLOSED",
    closesInMin: -95,
    startPriceMinor: 15_000,
    stepBps: 500,
    outcome: { kind: "SOLD", bids: 9, winner: "T9" },
  },
  {
    lot: 3,
    title: "Hand-wired split keyboard, 42 keys",
    category: "Electronics",
    condition: "Built this week",
    description: "Choc low-profile switches, wireless halves, walnut case. Firmware open source.",
    seller: "rohan",
    status: "OPEN",
    closesInMin: 18,
    startPriceMinor: 10_000,
    stepBps: 500,
  },
  {
    lot: 4,
    title: "Block-printed Bagru cotton throw",
    category: "Textiles",
    condition: "New, unwashed",
    description: "Natural indigo and madder dyes, 150 × 220 cm, printed by hand in Rajasthan.",
    seller: "meera",
    status: "OPEN",
    closesInMin: 46,
    startPriceMinor: 6_000,
    stepBps: 500,
  },
  {
    lot: 5,
    title: "Brass Dhokra elephant, 8 cm",
    category: "Craft",
    condition: "New",
    description: "Lost-wax cast brass from Bastar. Each piece is unique; this one has a raised trunk.",
    seller: "meera",
    status: "UPCOMING",
    closesInMin: 140,
    startPriceMinor: 4_500,
    stepBps: 700,
  },
  {
    lot: 6,
    title: "ESP32 dev board kit, first batch",
    category: "Electronics",
    condition: "Sealed",
    description: "Five boards, headers, jumper set and a USB-C cable. Good for a first tag build.",
    seller: "rohan",
    status: "UPCOMING",
    closesInMin: 210,
    startPriceMinor: 3_000,
    stepBps: 1_000,
  },
  {
    lot: 7,
    title: "Film reel tin, 35 mm, 1950s",
    category: "Collectibles",
    condition: "Empty, dented lid",
    description: "Steel reel tin with the original studio stencil on the lid. Reel not included.",
    seller: "studio",
    status: "CLOSED",
    closesInMin: -320,
    startPriceMinor: 12_000,
    stepBps: 500,
    outcome: { kind: "UNSOLD" },
  },
  {
    lot: 8,
    title: "Walnut mechanical metronome",
    category: "Music",
    condition: "Works, small scratch",
    description: "Clockwork metronome, 40–208 bpm, bell on every second to sixth beat.",
    seller: "meera",
    status: "CLOSED",
    closesInMin: -40,
    startPriceMinor: 5_000,
    stepBps: 500,
    outcome: { kind: "SOLD", bids: 5, winner: "R3", impostor: true },
  },
];

const fakeKey = (seed: string) => {
  let h1 = 0x811c9dc5;
  let out = "";
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < seed.length; i++) {
      h1 ^= seed.charCodeAt(i) + round;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    out += h1.toString(16).padStart(8, "0");
  }
  return `0x${out}`;
};

export interface SampleSet {
  listings: Listing[];
  definitions: Definition[];
  bids: BidRecord[];
  results: Result[];
  snapshots: Snapshot[];
}

export async function buildSampleSet(nowMs: number = Date.now()): Promise<SampleSet> {
  const listings: Listing[] = [];
  const definitions: Definition[] = [];
  const bids: BidRecord[] = [];
  const results: Result[] = [];
  const snapshots: Snapshot[] = [];

  for (const seed of SEEDS) {
    const pad = String(seed.lot).padStart(3, "0");
    const auctionId = `bid3-${pad}`;
    const listingId = `lot-${pad}`;
    const seller = SELLERS[seed.seller];
    const closesAtMs = nowMs + seed.closesInMin * 60_000;

    listings.push({
      key: fakeKey(`listing:${listingId}`),
      owner: seller.address,
      listingId,
      lotNumber: seed.lot,
      category: seed.category,
      status: seed.status,
      startPriceMinor: seed.startPriceMinor,
      closesAtMs,
      auctionId,
      sellerAlias: seller.alias,
      sellerAddress: seller.address,
      title: seed.title,
      description: seed.description,
      condition: seed.condition,
    });

    const rules = {
      auctionId,
      epoch: 1,
      listingId,
      startPriceMinor: seed.startPriceMinor,
      stepBps: seed.stepBps,
      countdownMs: 5_000,
      ceilingMinor: seed.startPriceMinor * 10,
      timeLimitMs: 600_000,
      unit: "demo credits",
    };
    const hash = await rulesHash(rules);
    definitions.push({ key: fakeKey(`def:${auctionId}`), owner: PUBLISHER, ...rules, rulesHash: hash });

    if (!seed.outcome) continue;

    if (seed.outcome.kind === "UNSOLD") {
      results.push({
        key: fakeKey(`result:${auctionId}`),
        owner: PUBLISHER,
        auctionId,
        epoch: 1,
        listingId,
        category: seed.category,
        status: "UNSOLD",
        hammerPriceMinor: 0,
        closedAtMs: closesAtMs,
        winnerAlias: "",
        finalSeq: 0,
        bidCount: 0,
        rulesHash: hash,
        transcriptDigest: fakeKey(`transcript:${auctionId}`),
      });
      continue;
    }

    const { bids: count, winner, impostor } = seed.outcome;
    const rival = winner === "Q2" ? "J5" : winner === "T9" ? "V1" : "H8";
    const startAt = closesAtMs - (count * 3_200 + 5_000);
    for (let i = 0; i < count; i++) {
      // Alternate paddles so the winner places the last bid.
      const bidder = (count - 1 - i) % 2 === 0 ? winner : rival;
      bids.push({
        key: fakeKey(`bid:${auctionId}:${i}`),
        owner: PUBLISHER,
        auctionId,
        epoch: 1,
        bidIndex: i,
        priceMinor: priceAtBid(rules, i),
        bidderAlias: bidder,
        serverSeq: 3 + i * 2,
        acceptedAtMs: startAt + i * 3_200 + (i % 3) * 410,
      });
    }
    results.push({
      key: fakeKey(`result:${auctionId}`),
      owner: impostor ? IMPOSTOR : PUBLISHER,
      auctionId,
      epoch: 1,
      listingId,
      category: seed.category,
      status: "SOLD",
      hammerPriceMinor: priceAtBid(rules, count - 1),
      closedAtMs: closesAtMs,
      winnerAlias: winner,
      finalSeq: 3 + (count - 1) * 2 + 1,
      bidCount: count,
      rulesHash: hash,
      transcriptDigest: fakeKey(`transcript:${auctionId}`),
    });
  }

  // A recent public snapshot for the open lots.
  for (const listing of listings.filter((l) => l.status === "OPEN")) {
    snapshots.push({
      key: fakeKey(`snap:${listing.auctionId}`),
      owner: PUBLISHER,
      auctionId: listing.auctionId,
      serverSeq: 12,
      phase: "COUNTDOWN",
      priceMinor: priceAtBid({ startPriceMinor: listing.startPriceMinor, stepBps: 500, ceilingMinor: listing.startPriceMinor * 10 }, 3),
      leaderAlias: "K7",
      activeCount: 2,
      generatedAtMs: nowMs - 8_000,
    });
  }

  return { listings, definitions, bids, results, snapshots };
}
