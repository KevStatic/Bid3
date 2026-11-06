// Regenerates tests/vectors.json from the web app's TypeScript, so the engine
// is tested against the exact code the browser runs.
//
//   node --experimental-strip-types engine/scripts/make_vectors.mjs
//
// Run from the repo root.
import { writeFileSync } from "node:fs";
import { priceAtBid } from "../../web/src/lib/pricing.ts";
import { canonicalRules, rulesHash } from "../../web/src/lib/rules-hash.ts";

const ladders = [
  { startPriceMinor: 10_000, stepBps: 500, ceilingMinor: 100_000 },
  { startPriceMinor: 4_500, stepBps: 700, ceilingMinor: 45_000 },
  { startPriceMinor: 3_000, stepBps: 1_000, ceilingMinor: 30_000 },
  { startPriceMinor: 12_345, stepBps: 333, ceilingMinor: 99_999 },
  { startPriceMinor: 1, stepBps: 5_000, ceilingMinor: 1_000_000 },
];

const pricing = ladders.map((rules) => ({
  ...rules,
  prices: Array.from({ length: 60 }, (_, i) => priceAtBid(rules, i)),
}));

const ruleSets = [
  { auctionId: "bid3-003", epoch: 1, listingId: "lot-003", startPriceMinor: 10_000, stepBps: 500, countdownMs: 5_000, ceilingMinor: 100_000, timeLimitMs: 600_000, unit: "demo credits" },
  { auctionId: "bid3-ü-✓", epoch: 7, listingId: "lot-x", startPriceMinor: 1, stepBps: 1, countdownMs: 10_000, ceilingMinor: 2, timeLimitMs: 1, unit: "crédits" },
];

const hashes = [];
for (const rules of ruleSets) {
  hashes.push({ rules, canonical: canonicalRules(rules), hash: await rulesHash(rules) });
}

writeFileSync(new URL("../tests/vectors.json", import.meta.url), JSON.stringify({ pricing, hashes }, null, 2) + "\n");
console.log(`wrote ${pricing.length} ladders and ${hashes.length} rule hashes`);
