"use client";

import { config, isSimulation } from "./config";
import { useEngineLots } from "./lot-state";
import { useEngineHealth } from "./use-featured-auction";

/** Phases in which a lot is open for bidding (or paused mid-round). */
export const LIVE_PHASES: ReadonlySet<string> = new Set(["LOBBY", "OPEN", "COUNTDOWN", "PAUSED"]);

/**
 * The lot open for bidding right now, or null when nothing is: the engine's active lot only counts
 * while it's still open, so a closed lot (or the old demo lot after a restart) never shows as live.
 * In simulation the built-in demo lot is always live.
 */
export function useLiveLot(): { liveId: string | null; ready: boolean; reachable: boolean } {
  const health = useEngineHealth();
  const lots = useEngineLots();
  if (isSimulation) return { liveId: config.featuredAuctionId, ready: true, reachable: true };
  const open = (lots.data ?? []).filter((lot) => LIVE_PHASES.has(lot.phase));
  const active = health.data?.activeAuctionId;
  const liveId = open.find((lot) => lot.auctionId === active)?.auctionId ?? open.at(-1)?.auctionId ?? null;
  return { liveId, ready: lots.isFetched, reachable: lots.isSuccess };
}
