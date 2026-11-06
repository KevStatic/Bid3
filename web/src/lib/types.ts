/**
 * Shared contract between the Bid3 engine and the web app.
 * Keep this file in sync with the engine's message schema.
 *
 * Money is always an integer count of minor units (2 decimals: 11576 = 115.76).
 * Times are epoch milliseconds on the engine's clock.
 */

export type Phase =
  | "DRAFT"
  | "LOBBY" // fewer than two paddles switched on
  | "OPEN" // two or more on, no bids yet
  | "COUNTDOWN" // a leader exists, the hammer countdown is running
  | "PAUSED" // link or infrastructure uncertain; nothing can be awarded
  | "SOLD_LOCKED"
  | "UNSOLD"
  | "CANCELLED";

export type PaddleStatus = "OUT" | "JOIN_PENDING" | "ACTIVE" | "LEAVE_PENDING" | "UNKNOWN";

export type Health = "ok" | "degraded" | "down";

export interface AuctionRules {
  startPriceMinor: number;
  /** Price step per accepted bid, in basis points. 500 = +5%. */
  stepBps: number;
  countdownMs: number;
  ceilingMinor: number;
  timeLimitMs: number;
  unit: string;
}

export interface Paddle {
  /** Per-round public alias, e.g. "K7". Never a device ID. */
  alias: string;
  status: PaddleStatus;
}

export interface BidEvent {
  serverSeq: number;
  /** 0 for the opening bid. */
  bidIndex: number;
  priceMinor: number;
  bidderAlias: string;
  acceptedAtMs: number;
}

export interface Countdown {
  deadlineMs: number;
  durationMs: number;
  generation: number;
}

export interface AuctionState {
  auctionId: string;
  epoch: number;
  stateVersion: number;
  phase: Phase;
  rules: AuctionRules;
  /** Price of the standing bid, or the opening price before any bid. */
  priceMinor: number;
  /** What the next accepted bid will cost. */
  nextPriceMinor: number;
  bidCount: number;
  leaderAlias: string | null;
  countdown: Countdown | null;
  paddles: Paddle[];
  health: { gateway: Health; bridge: Health; engine: Health };
  arkiv: { lastPublishedSeq: number | null; lastPublishedAtMs: number | null; pending: number };
  result: { winnerAlias: string; hammerPriceMinor: number; finalSeq: number } | null;
  pauseReason: string | null;
  serverTimeMs: number;
}

/** Messages on WS /auctions/{id}/stream */
export type StreamMessage =
  | { type: "snapshot"; state: AuctionState; bids: BidEvent[] }
  | { type: "state"; state: AuctionState }
  | { type: "bid"; bid: BidEvent; state: AuctionState };
