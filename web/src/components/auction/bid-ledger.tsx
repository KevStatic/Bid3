"use client";

import { clockTime, formatMinor } from "@/lib/format";
import type { BidEvent } from "@/lib/types";

/** Accepted bids, newest first. The newest row flashes once when it lands. */
export function BidLedger({
  bids,
  lastBidSeq,
  leaderAlias,
  sold = false,
  limit = 12,
  emptyText = "No bids yet. The first press on a switched-on paddle opens the bidding.",
}: {
  bids: BidEvent[];
  lastBidSeq: number | null;
  leaderAlias: string | null;
  sold?: boolean;
  limit?: number;
  emptyText?: string;
}) {
  if (bids.length === 0) {
    return <p className="px-5 py-8 text-ink-3">{emptyText}</p>;
  }

  return (
    <ol className="divide-y divide-line" aria-label="Accepted bids, newest first">
      {bids.slice(0, limit).map((bid, i) => {
        const isNewest = i === 0;
        const leading = isNewest && bid.bidderAlias === leaderAlias;
        return (
          <li
            key={bid.serverSeq}
            className={`grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 px-5 py-3 ${isNewest && bid.serverSeq === lastBidSeq ? "animate-row-in" : ""}`}
          >
            <span className="tabular text-sm text-ink-3">#{bid.bidIndex + 1}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold">Paddle {bid.bidderAlias}</span>
              {leading ? <span className="rounded-tag bg-paddle px-1.5 text-xs font-bold text-paddle-ink">{sold ? "Won" : "Leading"}</span> : null}
            </span>
            <span className="text-right">
              <span className="font-narrow tabular block text-xl font-bold leading-none">{formatMinor(bid.priceMinor)}</span>
              <span className="tabular text-xs text-ink-3">{clockTime(bid.acceptedAtMs)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
