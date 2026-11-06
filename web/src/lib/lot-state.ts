"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Listing, Result } from "./arkiv";
import { config } from "./config";
import { formatMinor } from "./format";
import type { Payment, PaymentStatus } from "./payments-shared";
import { useResults } from "./use-arkiv";

/**
 * Where a listed lot stands. A listing's own `status` field is written once by its seller and never
 * changes, so the room's real state comes from the engine (every lot it has run) and, when the engine
 * can't be reached, from the publisher's AuctionResult entities on Arkiv.
 */
export type LotState =
  | { kind: "live"; priceMinor: number; bidCount: number; leaderAlias: string | null }
  | { kind: "upNext" }
  | { kind: "sold"; priceMinor: number; winnerAlias: string | null; payment?: PaymentStatus }
  /** Won, but the winner didn't pay (payments.py), so the lot stays with the seller. */
  | { kind: "unpaid"; priceMinor: number; winnerAlias: string | null; reason: string }
  | { kind: "unsold" }
  | { kind: "cancelled" };

/** One row of the engine's public GET /auctions. */
export interface EngineLot {
  auctionId: string;
  listingId: string;
  phase: string;
  priceMinor: number;
  bidCount: number;
  leaderAlias?: string | null;
  /** The Sepolia payment for a sold lot. Missing on engines without payments; null when there is none. */
  payment?: Payment | null;
}

/** Every lot the engine knows, polled every 5 s. Disabled without an engine URL. */
export function useEngineLots() {
  return useQuery({
    queryKey: ["engine", "auctions"],
    enabled: !!config.engineHttpUrl,
    refetchInterval: 5_000,
    staleTime: 2_000,
    queryFn: async (): Promise<EngineLot[]> => {
      const response = await fetch(`${config.engineHttpUrl}/auctions`, { cache: "no-store" });
      if (!response.ok) throw new Error(`engine /auctions answered ${response.status}`);
      return (await response.json()) as EngineLot[];
    },
  });
}

export function lotStateOf(auctionId: string, engineLots: Map<string, EngineLot>, results: Map<string, Result>): LotState {
  const lot = engineLots.get(auctionId);
  if (lot) {
    switch (lot.phase) {
      case "SOLD_LOCKED":
        if (lot.payment?.status === "UNPAID") {
          return { kind: "unpaid", priceMinor: lot.priceMinor, winnerAlias: lot.leaderAlias ?? null, reason: lot.payment.reason ?? "No payment" };
        }
        return { kind: "sold", priceMinor: lot.priceMinor, winnerAlias: lot.leaderAlias ?? null, payment: lot.payment?.status };
      case "UNSOLD":
        return { kind: "unsold" };
      case "CANCELLED":
        return { kind: "cancelled" };
      case "DRAFT":
        return { kind: "upNext" };
      default:
        return { kind: "live", priceMinor: lot.priceMinor, bidCount: lot.bidCount, leaderAlias: lot.leaderAlias ?? null };
    }
  }
  const result = results.get(auctionId);
  if (result?.status === "SOLD") return { kind: "sold", priceMinor: result.hammerPriceMinor, winnerAlias: result.winnerAlias || null };
  if (result?.status === "UNSOLD") return { kind: "unsold" };
  if (result?.status === "CANCELLED") return { kind: "cancelled" };
  return { kind: "upNext" };
}

/** The state of each listing, keyed by its auctionId. Only results written by the Bid3 publisher count. */
export function useLotStates(listings: Listing[] | undefined) {
  const engine = useEngineLots();
  const results = useResults();
  const states = useMemo(() => {
    const engineLots = new Map((engine.data ?? []).map((lot) => [lot.auctionId, lot]));
    const published = new Map(
      (results.data ?? []).filter((r) => r.owner.toLowerCase() === config.publisherAddress).map((r) => [r.auctionId, r]),
    );
    return new Map((listings ?? []).map((l) => [l.auctionId, lotStateOf(l.auctionId, engineLots, published)]));
  }, [engine.data, results.data, listings]);
  return { states, engineReachable: engine.isSuccess };
}

/** One sentence on where a lot stands. */
export function lotStateLine(state: LotState): string {
  switch (state.kind) {
    case "live":
      return state.bidCount === 0
        ? "Bidding is open"
        : `${state.bidCount} ${state.bidCount === 1 ? "bid" : "bids"}, Paddle ${state.leaderAlias} at ${formatMinor(state.priceMinor)}`;
    case "upNext":
      return "Waiting for the auctioneer to open bidding";
    case "sold": {
      const sold = state.winnerAlias ? `Sold to Paddle ${state.winnerAlias} for ${formatMinor(state.priceMinor)}` : `Sold for ${formatMinor(state.priceMinor)}`;
      return state.payment === "PAID" ? `${sold}, paid` : state.payment === "DUE" ? `${sold}, waiting for payment` : sold;
    }
    case "unpaid":
      return `Won by Paddle ${state.winnerAlias} at ${formatMinor(state.priceMinor)}, not paid. Stays with the seller`;
    case "unsold":
      return "No bids in time. Back with the seller";
    case "cancelled":
      return "Withdrawn by the auctioneer";
  }
}

/** Live first, then up next, then everything that has closed. */
export const LOT_STATE_ORDER: Record<LotState["kind"], number> = { live: 0, upNext: 1, sold: 2, unpaid: 3, unsold: 3, cancelled: 4 };
