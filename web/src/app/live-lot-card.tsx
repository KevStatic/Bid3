"use client";

import Link from "next/link";
import { HammerBar } from "@/components/auction/hammer-bar";
import { phaseHeadline, priceLabel } from "@/components/auction/phase-copy";
import { PriceDisplay } from "@/components/auction/price-display";
import { buttonClass, LotTag, Skeleton, SourceBadge } from "@/components/ui";
import { useAuctionStream, useCountdown } from "@/lib/use-auction-stream";
import { useListingByAuction } from "@/lib/use-arkiv";

export function LiveLotCard({ auctionId }: { auctionId: string }) {
  const { state, source, clockOffsetMs, lastBidSeq } = useAuctionStream(auctionId);
  const msLeft = useCountdown(state, clockOffsetMs);
  const { data: lot } = useListingByAuction(auctionId);

  return (
    <div className="relative min-w-0 rounded-stage border border-line bg-surface p-6 shadow-lift sm:p-8">
      <div className="flex items-center gap-3">
        {lot ? <LotTag lot={lot.lotNumber} /> : <Skeleton className="h-7 w-16" />}
        <span className="min-w-0 truncate text-sm text-ink-2">{lot?.title ?? ""}</span>
        <SourceBadge source={source} className="ml-auto shrink-0" />
      </div>

      {state ? (
        <>
          <p className="mt-7 text-sm font-semibold text-ink-2">{priceLabel(state)}</p>
          <div className="mt-1">
            <PriceDisplay
              priceMinor={state.priceMinor}
              unit={state.rules.unit}
              bidSeq={lastBidSeq}
              size="card"
              sold={state.phase === "SOLD_LOCKED"}
            />
          </div>
          <p className="mt-4 min-h-7 text-lg font-semibold" aria-live="polite">
            {phaseHeadline(state)}
          </p>
          <div className="mt-5">
            <HammerBar state={state} msLeft={msLeft} size="md" />
          </div>
        </>
      ) : (
        <div className="mt-7 space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-20 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      )}

      <Link href={`/room/${auctionId}`} className={buttonClass("primary", "lg", "mt-7 w-full")}>
        Watch the room
      </Link>
    </div>
  );
}
