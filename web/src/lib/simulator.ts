import { priceAtBid } from "./pricing";
import type { AuctionRules, AuctionState, BidEvent, Paddle, StreamMessage } from "./types";

/**
 * In-browser stand-in for the Bid3 engine, used when no engine URL is
 * configured. It follows the same rules as the engine so the UI can be built
 * and demoed without hardware. Everything it produces is labelled
 * "Simulation" in the UI and must never be presented as hardware bidding.
 */

export type SimAction = { at: number; kind: "join" | "leave" | "bid"; alias: string };

export const DEFAULT_RULES: AuctionRules = {
  startPriceMinor: 10_000,
  stepBps: 500,
  countdownMs: 5_000,
  ceilingMinor: 100_000,
  timeLimitMs: 10 * 60_000,
  unit: "demo credits",
};

/** A scripted round: two paddles, an outbid war, a dropout and a late re-entry. */
const SCRIPT: SimAction[] = [
  { at: 900, kind: "join", alias: "K7" },
  { at: 1_900, kind: "join", alias: "M4" },
  { at: 3_400, kind: "bid", alias: "K7" },
  { at: 6_100, kind: "bid", alias: "M4" },
  { at: 9_300, kind: "bid", alias: "K7" },
  { at: 10_600, kind: "leave", alias: "M4" },
  { at: 13_000, kind: "join", alias: "M4" },
  { at: 13_900, kind: "bid", alias: "M4" },
  { at: 17_600, kind: "bid", alias: "K7" },
  { at: 21_900, kind: "bid", alias: "M4" },
];

type Listener = (message: StreamMessage) => void;

export interface SimulatorOptions {
  auctionId: string;
  rules?: AuctionRules;
  aliases?: string[];
  autoplay?: boolean;
  /** Pause between a finished round and the next one, in autoplay. */
  restartDelayMs?: number;
}

export class AuctionSimulator {
  private readonly auctionId: string;
  private readonly rules: AuctionRules;
  private readonly aliases: string[];
  private readonly restartDelayMs: number;
  private autoplay: boolean;

  private state!: AuctionState;
  private bids: BidEvent[] = [];
  private seq = 0;
  private hadCompetition = false;
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private roundStartedAt = 0;

  constructor(options: SimulatorOptions) {
    this.auctionId = options.auctionId;
    this.rules = options.rules ?? DEFAULT_RULES;
    this.aliases = options.aliases ?? ["K7", "M4"];
    this.autoplay = options.autoplay ?? true;
    this.restartDelayMs = options.restartDelayMs ?? 7_000;
    this.resetRound(1);
  }

  // ---------------------------------------------------------------- public

  start() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 100);
    if (this.autoplay) this.scheduleScript();
    this.emitSnapshot();
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.clearTimers();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", state: this.snapshot(), bids: [...this.bids] });
    return () => this.listeners.delete(listener);
  }

  isAutoplay() {
    return this.autoplay;
  }

  setAutoplay(on: boolean) {
    this.autoplay = on;
    this.clearTimers();
    if (on) this.restartRound();
  }

  restartRound() {
    this.clearTimers();
    this.resetRound(this.state.epoch + 1);
    this.emitSnapshot();
    if (this.autoplay) this.scheduleScript();
  }

  /** Manual controls (keyboard shortcuts in the room). */
  toggle(alias: string) {
    const paddle = this.paddle(alias);
    if (!paddle) return;
    if (paddle.status === "ACTIVE") this.leave(alias);
    else this.join(alias);
  }

  join(alias: string) {
    if (this.isClosed()) return;
    const paddle = this.paddle(alias);
    if (!paddle || paddle.status === "ACTIVE") return;
    paddle.status = "ACTIVE";
    if (this.activeCount() >= 2) this.hadCompetition = true;
    if (this.state.phase === "LOBBY" && this.activeCount() >= 2) this.state.phase = "OPEN";
    this.commit();
  }

  leave(alias: string) {
    if (this.isClosed()) return;
    const paddle = this.paddle(alias);
    if (!paddle || paddle.status !== "ACTIVE") return;
    paddle.status = "OUT";
    // A standing leading bid stays binding; the countdown keeps running.
    if (this.state.phase === "OPEN" && this.activeCount() < 2) this.state.phase = "LOBBY";
    this.commit();
  }

  /** Returns why a bid was refused, or null when accepted. */
  bid(alias: string): "CLOSED" | "NOT_ACTIVE" | "LEADING" | "NOT_OPEN" | "CEILING" | null {
    if (this.isClosed()) return "CLOSED";
    const paddle = this.paddle(alias);
    if (!paddle || paddle.status !== "ACTIVE") return "NOT_ACTIVE";
    if (this.state.phase !== "OPEN" && this.state.phase !== "COUNTDOWN") return "NOT_OPEN";
    if (this.state.leaderAlias === alias) return "LEADING";
    if (this.state.bidCount > 0 && this.state.priceMinor >= this.rules.ceilingMinor) return "CEILING";

    const price = priceAtBid(this.rules, this.state.bidCount);
    const now = Date.now();
    const bid: BidEvent = {
      serverSeq: ++this.seq,
      bidIndex: this.state.bidCount,
      priceMinor: price,
      bidderAlias: alias,
      acceptedAtMs: now,
    };
    this.bids = [bid, ...this.bids];
    this.state.bidCount += 1;
    this.state.priceMinor = price;
    this.state.nextPriceMinor = priceAtBid(this.rules, this.state.bidCount);
    this.state.leaderAlias = alias;
    this.state.phase = "COUNTDOWN";
    this.state.countdown = {
      deadlineMs: now + this.rules.countdownMs,
      durationMs: this.rules.countdownMs,
      generation: (this.state.countdown?.generation ?? 0) + 1,
    };
    this.state.arkiv.pending += 1;
    this.bumpVersion();
    this.emit({ type: "bid", bid, state: this.snapshot() });
    return null;
  }

  // --------------------------------------------------------------- private

  private resetRound(epoch: number) {
    this.seq = 0;
    this.bids = [];
    this.hadCompetition = false;
    this.roundStartedAt = Date.now();
    const paddles: Paddle[] = this.aliases.map((alias) => ({ alias, status: "OUT" }));
    this.state = {
      auctionId: this.auctionId,
      epoch,
      stateVersion: 1,
      phase: "LOBBY",
      rules: this.rules,
      priceMinor: this.rules.startPriceMinor,
      nextPriceMinor: this.rules.startPriceMinor,
      bidCount: 0,
      leaderAlias: null,
      countdown: null,
      paddles,
      health: { gateway: "ok", bridge: "ok", engine: "ok" },
      arkiv: { lastPublishedSeq: null, lastPublishedAtMs: null, pending: 0 },
      result: null,
      pauseReason: null,
      serverTimeMs: Date.now(),
    };
  }

  private tick() {
    const now = Date.now();

    // Pretend the Arkiv worker publishes coalesced snapshots every ~4 s.
    if (this.state.arkiv.pending > 0 && now - (this.state.arkiv.lastPublishedAtMs ?? 0) > 4_000) {
      this.state.arkiv = { lastPublishedSeq: this.seq, lastPublishedAtMs: now, pending: 0 };
      this.commit();
    }

    if (this.state.phase === "COUNTDOWN" && this.state.countdown && now >= this.state.countdown.deadlineMs) {
      if (this.state.leaderAlias && this.hadCompetition) {
        this.state.phase = "SOLD_LOCKED";
        this.state.result = {
          winnerAlias: this.state.leaderAlias,
          hammerPriceMinor: this.state.priceMinor,
          finalSeq: this.seq,
        };
        this.state.countdown = null;
        this.state.arkiv.pending += 1;
        this.commit();
        if (this.autoplay) this.timers.push(setTimeout(() => this.restartRound(), this.restartDelayMs));
      }
    }

    if (!this.isClosed() && now - this.roundStartedAt > this.rules.timeLimitMs && this.state.bidCount === 0) {
      this.state.phase = "UNSOLD";
      this.commit();
    }
  }

  private scheduleScript() {
    for (const step of SCRIPT) {
      const alias = this.aliases[step.alias === "K7" ? 0 : 1] ?? step.alias;
      this.timers.push(
        setTimeout(() => {
          if (step.kind === "join") this.join(alias);
          else if (step.kind === "leave") this.leave(alias);
          else this.bid(alias);
        }, step.at),
      );
    }
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private isClosed() {
    return this.state.phase === "SOLD_LOCKED" || this.state.phase === "UNSOLD" || this.state.phase === "CANCELLED";
  }

  private paddle(alias: string) {
    return this.state.paddles.find((p) => p.alias === alias);
  }

  private activeCount() {
    return this.state.paddles.filter((p) => p.status === "ACTIVE").length;
  }

  private bumpVersion() {
    this.state.stateVersion += 1;
    this.state.serverTimeMs = Date.now();
  }

  private commit() {
    this.bumpVersion();
    this.emit({ type: "state", state: this.snapshot() });
  }

  private emitSnapshot() {
    this.emit({ type: "snapshot", state: this.snapshot(), bids: [...this.bids] });
  }

  private snapshot(): AuctionState {
    return structuredClone(this.state);
  }

  private emit(message: StreamMessage) {
    for (const listener of this.listeners) listener(message);
  }
}
