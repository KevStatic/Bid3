"use client";

import Link from "next/link";
import { Skeleton, SourceBadge } from "@/components/ui";
import { formatMinor, fromNow } from "@/lib/format";
import { useListings, useResults } from "@/lib/use-arkiv";
import { isSampleArkiv } from "@/lib/config";
import { useNow } from "@/lib/use-now";

export function RecentResults() {
  const results = useResults();
  const nowMs = useNow();
  const listings = useListings({ status: "CLOSED" });
  const titleFor = (listingId: string) => listings.data?.find((l) => l.listingId === listingId)?.title;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">Recent hammer prices</h3>
        <SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />
      </div>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {results.isLoading
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="py-4">
                <Skeleton className="h-5 w-2/3" />
              </li>
            ))
          : results.data?.slice(0, 4).map((r) => (
              <li key={r.key}>
                <Link
                  href={`/auction/${r.auctionId}/bids`}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 py-4 transition-colors hover:text-cobalt"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{titleFor(r.listingId) ?? r.listingId}</span>
                    <span className="text-sm text-ink-3">
                      {[r.status === "SOLD" ? `Paddle ${r.winnerAlias}, ${r.bidCount} bids` : "No sale", nowMs !== null ? `closed ${fromNow(r.closedAtMs, nowMs)}` : null]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  <span className="font-narrow tabular text-2xl font-bold">
                    {r.status === "SOLD" ? formatMinor(r.hammerPriceMinor) : "Unsold"}
                  </span>
                </Link>
              </li>
            ))}
      </ul>
      <Link href="/explorer" className="mt-4 inline-block text-sm font-semibold text-cobalt hover:underline">
        Check any result yourself
      </Link>
    </div>
  );
}
