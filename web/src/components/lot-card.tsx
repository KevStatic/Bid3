import Link from "next/link";
import type { Listing } from "@/lib/arkiv";
import { formatMinor, fromNow, shortAddress } from "@/lib/format";
import { lotStateLine as stateLine, type LotState } from "@/lib/lot-state";
import { buttonClass, LotTag, Pill } from "./ui";

const STATUS = {
  OPEN: { label: "Bidding now", tone: "live" as const },
  UPCOMING: { label: "Opens soon", tone: "cobalt" as const },
  CLOSED: { label: "Closed", tone: "neutral" as const },
};

const STATE = {
  live: { label: "Live now", tone: "live" as const },
  upNext: { label: "Up next", tone: "cobalt" as const },
  sold: { label: "Sold", tone: "paddle" as const },
  unpaid: { label: "Not paid", tone: "neutral" as const },
  unsold: { label: "Unsold", tone: "neutral" as const },
  cancelled: { label: "Withdrawn", tone: "neutral" as const },
};

/**
 * A lot in the catalogue. With `state` (live mode) the badge, status line and button follow the
 * room's real state; without it they fall back to the listing's own status field.
 */
export function LotCard({ listing, nowMs, state }: { listing: Listing; nowMs: number | null; state?: LotState }) {
  const status = state ? STATE[state.kind] : STATUS[listing.status];
  const live = state ? state.kind === "live" : listing.status === "OPEN";
  const timeText = state
    ? stateLine(state)
    : nowMs === null
      ? ""
      : listing.status === "CLOSED"
        ? `Closed ${fromNow(listing.closesAtMs, nowMs)}`
        : `Closes ${fromNow(listing.closesAtMs, nowMs)}`;
  const closed = state ? state.kind !== "live" && state.kind !== "upNext" : listing.status === "CLOSED";

  return (
    <article className="flex h-full flex-col rounded-panel border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between gap-3">
        <LotTag lot={listing.lotNumber} size="sm" />
        <Pill tone={status.tone}>
          {live ? <span className="size-1.5 rounded-full bg-live animate-pulse-dot" aria-hidden /> : null}
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
        <div className="mt-3 flex items-start justify-between gap-3 text-sm text-ink-3">
          <span>{timeText}</span>
          <span className="shrink-0" title={`Listing owned by ${listing.owner}`}>
            {listing.sellerAlias}
          </span>
        </div>
        <p className="tabular mt-1 text-xs text-ink-3">Owner {shortAddress(listing.owner)}</p>

        <div className="mt-4">
          {live ? (
            <Link href={`/room/${listing.auctionId}`} className={buttonClass("primary", "md", "w-full")}>
              Watch the room
            </Link>
          ) : closed ? (
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
