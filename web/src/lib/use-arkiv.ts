"use client";

import { useQuery } from "@tanstack/react-query";
import { getArkivReader, type ListingFilter } from "./arkiv";

/** React Query wrappers around the Arkiv reader. Every call runs in the browser. */

export function useListings(filter: ListingFilter) {
  return useQuery({
    queryKey: ["arkiv", "listings", filter],
    queryFn: async () => (await getArkivReader()).listListings(filter),
    placeholderData: (previous) => previous,
  });
}

export function useListingByAuction(auctionId: string) {
  return useQuery({
    queryKey: ["arkiv", "listing", auctionId],
    queryFn: async () => (await getArkivReader()).getListingByAuction(auctionId),
  });
}

export function useDefinition(auctionId: string) {
  return useQuery({
    queryKey: ["arkiv", "definition", auctionId],
    queryFn: async () => (await getArkivReader()).getDefinition(auctionId),
  });
}

export function useBids(auctionId: string) {
  return useQuery({
    queryKey: ["arkiv", "bids", auctionId],
    queryFn: async () => (await getArkivReader()).listBids(auctionId),
  });
}

export function useResults() {
  return useQuery({
    queryKey: ["arkiv", "results"],
    queryFn: async () => (await getArkivReader()).listResults(),
  });
}

export function useLatestSnapshot(auctionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["arkiv", "snapshot", auctionId],
    queryFn: async () => (await getArkivReader()).getLatestSnapshot(auctionId),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}
