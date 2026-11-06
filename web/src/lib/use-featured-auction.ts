"use client";

import { useQuery } from "@tanstack/react-query";
import { config } from "./config";

export interface EngineHealth {
  activeAuctionId: string | null;
  bridgeConnected: boolean;
}

/**
 * The engine's GET /health, shared by every component through one React Query entry and polled
 * every 10 s. Disabled in simulation (no engine URL). `data` stays undefined while the engine is
 * unreachable.
 */
export function useEngineHealth() {
  return useQuery({
    queryKey: ["engine", "health"],
    enabled: !!config.engineHttpUrl,
    refetchInterval: 10_000,
    staleTime: 5_000,
    queryFn: async (): Promise<EngineHealth> => {
      const response = await fetch(`${config.engineHttpUrl}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`engine /health answered ${response.status}`);
      const body = (await response.json()) as Partial<EngineHealth>;
      return { activeAuctionId: body.activeAuctionId ?? null, bridgeConnected: !!body.bridgeConnected };
    },
  });
}

/**
 * The auction the home page, header and seat pages point at. In live mode it is the engine's
 * activeAuctionId, so a new lot needs no redeploy; the build-time NEXT_PUBLIC_FEATURED_AUCTION_ID
 * is the fallback (and the only source in simulation).
 */
export function useFeaturedAuctionId(): string {
  const { data } = useEngineHealth();
  return data?.activeAuctionId ?? config.featuredAuctionId;
}
