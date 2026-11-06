/**
 * Canonical rules hash.
 *
 * sha256 over the UTF-8 JSON of these fields, keys in this exact order, no
 * whitespace. The engine must produce the same string before publishing an
 * AuctionDefinition; the results explorer recomputes it in the browser.
 */
export interface HashableRules {
  auctionId: string;
  epoch: number;
  listingId: string;
  startPriceMinor: number;
  stepBps: number;
  countdownMs: number;
  ceilingMinor: number;
  timeLimitMs: number;
  unit: string;
}

export function canonicalRules(rules: HashableRules): string {
  return JSON.stringify({
    auctionId: rules.auctionId,
    epoch: rules.epoch,
    listingId: rules.listingId,
    startPriceMinor: rules.startPriceMinor,
    stepBps: rules.stepBps,
    countdownMs: rules.countdownMs,
    ceilingMinor: rules.ceilingMinor,
    timeLimitMs: rules.timeLimitMs,
    unit: rules.unit,
  });
}

export async function rulesHash(rules: HashableRules): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRules(rules));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "0x" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
