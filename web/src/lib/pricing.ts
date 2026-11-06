import type { AuctionRules } from "./types";

const BPS = 10_000n;

/**
 * Exact price of the bid at `bidIndex` (0 = opening bid).
 *
 *   price(n) = min(ceiling, round_half_up(start × (10000 + stepBps)^n / 10000^n))
 *
 * Always computed from the start price and the bid count, never by
 * compounding the previous displayed price, so there is no rounding drift.
 * The engine must use the same formula.
 */
export function priceAtBid(rules: Pick<AuctionRules, "startPriceMinor" | "stepBps" | "ceilingMinor">, bidIndex: number): number {
  if (!Number.isInteger(bidIndex) || bidIndex < 0) throw new RangeError("bidIndex must be a non-negative integer");
  const start = BigInt(rules.startPriceMinor);
  const ceiling = BigInt(rules.ceilingMinor);
  const factor = BPS + BigInt(rules.stepBps);
  const n = BigInt(bidIndex);

  const numerator = start * factor ** n;
  const denominator = BPS ** n;
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;

  return Number(quotient < ceiling ? quotient : ceiling);
}

/** First `count` prices of the bid ladder, stopping at the ceiling. */
export function bidLadder(rules: Pick<AuctionRules, "startPriceMinor" | "stepBps" | "ceilingMinor">, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const price = priceAtBid(rules, i);
    out.push(price);
    if (price >= rules.ceilingMinor) break;
  }
  return out;
}

/** Number of accepted bids needed to reach the ceiling. */
export function bidsToCeiling(rules: Pick<AuctionRules, "startPriceMinor" | "stepBps" | "ceilingMinor">): number {
  if (rules.stepBps <= 0) return Infinity;
  let i = 0;
  while (priceAtBid(rules, i) < rules.ceilingMinor) {
    i++;
    if (i > 10_000) return Infinity;
  }
  return i + 1;
}
