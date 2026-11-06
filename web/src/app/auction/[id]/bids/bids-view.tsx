"use client";

import Link from "next/link";
import { QueryDisclosure } from "@/components/query-disclosure";
import { buttonClass, LotTag, PageHeader, Panel, Pill, Skeleton, SourceBadge } from "@/components/ui";
import { QUERY_SNIPPETS } from "@/lib/arkiv";
import { explorerEntityUrl, isSampleArkiv } from "@/lib/config";
import { clockTime, formatMinor, percentFromBps, shortDateTime, shortKey } from "@/lib/format";
import { useBids, useDefinition, useListingByAuction, useResults } from "@/lib/use-arkiv";

export function BidsView({ auctionId }: { auctionId: string }) {
  const listing = useListingByAuction(auctionId);
  const definition = useDefinition(auctionId);
  const bids = useBids(auctionId);
  const results = useResults();
  const result = results.data?.find((r) => r.auctionId === auctionId);
  const lot = listing.data;

  return (
    <>
      <PageHeader
        title={lot?.title ?? (listing.isLoading ? "Loading lot…" : `Auction ${auctionId}`)}
        lede={
          lot ? (
            <span className="flex flex-wrap items-center gap-3">
              <LotTag lot={lot.lotNumber} size="sm" />
              <span>
                Sold by {lot.sellerAlias}. Every row below is its own Arkiv entity, written once when the engine accepted the press.
              </span>
            </span>
          ) : undefined
        }
        aside={
          <>
            <SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />
            {lot?.status === "OPEN" ? (
              <Link href={`/room/${auctionId}`} className={buttonClass("primary", "sm")}>
                Watch the room
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold">Accepted bids</h2>
            <span className="text-sm text-ink-3">{bids.data ? `${bids.data.length} on record` : ""}</span>
          </div>

          {bids.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : bids.data && bids.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left">
                <thead className="text-xs text-ink-3">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Bid
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Paddle
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Accepted
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Entity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {bids.data.map((bid, i) => (
                    <tr key={bid.key} className={i === 0 && result?.status === "SOLD" ? "bg-paddle-soft/60" : ""}>
                      <td className="tabular px-5 py-3 text-sm text-ink-3">#{bid.bidIndex + 1}</td>
                      <td className="px-3 py-3 font-semibold">
                        Paddle {bid.bidderAlias}
                        {i === 0 && result?.status === "SOLD" ? (
                          <span className="ml-2 rounded-tag bg-paddle px-1.5 text-xs font-bold text-paddle-ink">Winning bid</span>
                        ) : null}
                      </td>
                      <td className="font-narrow tabular px-3 py-3 text-right text-xl font-bold">{formatMinor(bid.priceMinor)}</td>
                      <td className="tabular px-3 py-3 text-sm text-ink-2">{clockTime(bid.acceptedAtMs)}</td>
                      <td className="px-5 py-3">
                        <a
                          className="tabular text-sm text-cobalt hover:underline"
                          href={explorerEntityUrl(bid.key)}
                          target="_blank"
                          rel="noreferrer"
                          title={bid.key}
                        >
                          {shortKey(bid.key)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-10 text-ink-3">
              {lot?.status === "UPCOMING" ? "Bidding hasn't opened on this lot yet." : "No bids on record for this auction."}
            </p>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel className="p-5">
            <h2 className="text-base font-bold">Outcome</h2>
            {result ? (
              <div className="mt-3">
                {result.status === "SOLD" ? (
                  <>
                    <p className="font-narrow tabular text-5xl font-extrabold leading-none">{formatMinor(result.hammerPriceMinor)}</p>
                    <p className="mt-2 text-ink-2">Sold to Paddle {result.winnerAlias}</p>
                  </>
                ) : (
                  <p className="text-xl font-semibold">Closed without a sale</p>
                )}
                <p className="mt-1 text-sm text-ink-3">{shortDateTime(result.closedAtMs)}</p>
                <Link href={`/explorer#${result.auctionId}`} className="mt-4 inline-block text-sm font-semibold text-cobalt hover:underline">
                  Verify this result
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-ink-2">{lot?.status === "OPEN" ? <Pill tone="live">Bidding now</Pill> : "No result published yet."}</p>
            )}
          </Panel>

          <Panel className="p-5">
            <h2 className="text-base font-bold">Frozen rules</h2>
            {definition.data ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">Opening bid</dt>
                <dd className="tabular text-right font-semibold">{formatMinor(definition.data.startPriceMinor)}</dd>
                <dt className="text-ink-3">Each bid adds</dt>
                <dd className="tabular text-right font-semibold">{percentFromBps(definition.data.stepBps)}</dd>
                <dt className="text-ink-3">Hammer after</dt>
                <dd className="tabular text-right font-semibold">{definition.data.countdownMs / 1000} s</dd>
                <dt className="text-ink-3">Ceiling</dt>
                <dd className="tabular text-right font-semibold">{formatMinor(definition.data.ceilingMinor)}</dd>
                <dt className="col-span-2 mt-2 text-ink-3">Rules hash</dt>
                <dd className="tabular col-span-2 break-all text-xs">{definition.data.rulesHash}</dd>
              </dl>
            ) : (
              <Skeleton className="mt-3 h-24 w-full" />
            )}
          </Panel>

          <QueryDisclosure query={QUERY_SNIPPETS.bids(auctionId)} />
        </div>
      </div>
    </>
  );
}
