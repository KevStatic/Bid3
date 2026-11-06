import { formatMinor } from "@/lib/format";
import type { AuctionState } from "@/lib/types";

/** One plain sentence describing what is happening in the room right now. */
export function phaseHeadline(state: AuctionState): string {
  const active = state.paddles.filter((p) => p.status === "ACTIVE").length;
  switch (state.phase) {
    case "DRAFT":
      return "This lot is being set up";
    case "LOBBY":
      return active === 0 ? "Waiting for paddles to switch on" : "Waiting for one more paddle";
    case "OPEN":
      return `Bidding is open. The first press bids ${formatMinor(state.nextPriceMinor)}.`;
    case "COUNTDOWN":
      return `Paddle ${state.leaderAlias} leads`;
    case "PAUSED":
      return "Paused. No paddle can win until the room reconnects.";
    case "SOLD_LOCKED":
      return state.result ? `Sold to Paddle ${state.result.winnerAlias}` : "Sold";
    case "UNSOLD":
      return "Closed without a sale";
    case "CANCELLED":
      return "This auction was cancelled";
  }
}

export function priceLabel(state: AuctionState): string {
  if (state.phase === "SOLD_LOCKED") return "Hammer price";
  if (state.bidCount === 0) return "Opening bid";
  return "Current bid";
}
