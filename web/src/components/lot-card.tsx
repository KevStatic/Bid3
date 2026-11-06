import Link from "next/link";
import type { Listing } from "@/lib/arkiv";
import { formatMinor, fromNow, shortAddress } from "@/lib/format";
import { buttonClass, LotTag, Pill } from "./ui";

const STATUS = {
  OPEN: { label: "Bidding now", tone: "live" as const },
  UPCOMING: { label: "Opens soon", tone: "cobalt" as const },
  CLOSED: { label: "Closed", tone: "neutral" as const },
};

export function LotCard({ listing, nowMs }: { listing: Listing; nowMs: number | null }) {
  const status = STATUS[listing.status];
  const timeText =
    nowMs === null ? "" : listing.status === "CLOSED" ? `Closed ${fromNow(listing.closesAtMs, nowMs)}` : `Closes ${fromNow(listing.closesAtMs, nowMs)}`;

  return (
    <article className="flex h-full flex-col rounded-panel border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between gap-3">
        <LotTag lot={listing.lotNumber} size="sm" />
        <Pill tone={status.tone}>
          {listing.status === "OPEN" ? <span className="size-1.5 rounded-full bg-live animate-pulse-dot" aria-hidden /> : null}
          {status.label}
        </Pill>
      </div>

      <h2 className="mt-4 text-lg font-bold leading-snug" style={{ fontStretch: "105%" }}>
        {listing.title}
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {listing.category}, {listing.condition.toLowerCase()}
      </p>

      <div className="mt-auto pt-6">
        <p className="text-xs font-medium text-ink-3">Opening bid</p>
        <p className="font-narrow tabular text-3xl font-extrabold leading-tight">{formatMinor(listing.startPriceMinor)}</p>
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-ink-3">
          <span>{timeText}</span>
          <span title={`Listing owned by ${listing.owner}`}>{listing.sellerAlias}</span>
        </div>
        <p className="tabular mt-1 text-xs text-ink-3">Owner {shortAddress(listing.owner)}</p>

        <div className="mt-4">
          {listing.status === "OPEN" ? (
            <Link href={`/room/${listing.auctionId}`} className={buttonClass("primary", "md", "w-full")}>
              Watch the room
            </Link>
          ) : listing.status === "CLOSED" ? (
            <Link href={`/auction/${listing.auctionId}/bids`} className={buttonClass("outline", "md", "w-full")}>
              See the bids
            </Link>
          ) : (
            <Link href="/#how-it-works" className={buttonClass("outline", "md", "w-full")}>
              How bidding works
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
