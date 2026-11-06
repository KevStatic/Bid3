"use client";

import Link from "next/link";
import { useState } from "react";
import { QueryDisclosure } from "@/components/query-disclosure";
import { CheckMark, PageHeader, Panel, Skeleton, SourceBadge } from "@/components/ui";
import { QUERY_SNIPPETS, type Result } from "@/lib/arkiv";
import { config, explorerEntityUrl, isSampleArkiv } from "@/lib/config";
import { formatMinor, shortAddress, shortDateTime, shortKey } from "@/lib/format";
import { useListings, useResults } from "@/lib/use-arkiv";
import { useVerification } from "@/lib/use-verification";

export function ExplorerView() {
  const results = useResults();
  const listings = useListings({});
  const titleFor = (listingId: string) => listings.data?.find((l) => l.listingId === listingId)?.title ?? listingId;

  return (
    <>
      <PageHeader
        title="Results"
        lede="Every hammer price, checked in your browser against Arkiv. This page never talks to the Bid3 engine, so it works even when we're offline."
        aside={<SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3">
          {results.isLoading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-panel" />)
            : results.data?.map((r) => <ResultRow key={r.key} result={r} title={titleFor(r.listingId)} />)}
          {results.data?.length === 0 ? (
            <Panel className="p-10 text-center">
              <p className="text-lg font-semibold">No results published yet</p>
              <p className="mt-1 text-ink-2">Results appear here the moment a round closes and the worker writes it to Arkiv.</p>
            </Panel>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <Panel className="p-5">
            <h2 className="text-base font-bold">What each check proves</h2>
            <dl className="mt-4 flex flex-col gap-4 text-sm">
              <div>
                <dt className="font-semibold">Published by Bid3</dt>
                <dd className="mt-0.5 text-ink-2">
                  The result entity is owned by our publisher wallet,{" "}
                  <span className="tabular" title={config.publisherAddress}>
                    {shortAddress(config.publisherAddress)}
                  </span>
                  . Entities in the same shape from any other wallet are flagged.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Rules match</dt>
                <dd className="mt-0.5 text-ink-2">
                  Your browser hashes the frozen rules and compares them to the hash the result was closed under.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Bids add up</dt>
                <dd className="mt-0.5 text-ink-2">The bid entities match the result&apos;s count, final price and winning paddle.</dd>
              </div>
              <div>
                <dt className="font-semibold">Every bid on the ladder</dt>
                <dd className="mt-0.5 text-ink-2">
                  Your browser reprices every bid from the frozen rules. A bid at the wrong price, a missing bid or a paddle outbidding itself fails.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Transcript matches</dt>
                <dd className="mt-0.5 text-ink-2">
                  The result is sealed with a hash of every bid. Your browser rehashes the bid entities; adding, removing or editing any bid breaks it.
                </dd>
              </div>
            </dl>
          </Panel>
          <QueryDisclosure query={QUERY_SNIPPETS.results} />
        </aside>
      </div>
    </>
  );
}

function ResultRow({ result, title }: { result: Result; title: string }) {
  const verification = useVerification(result);
  const [open, setOpen] = useState(false);
  const v = verification.data;
  const flagged = v && !v.allOk;

  return (
    <article id={result.auctionId} className={`scroll-mt-24 rounded-panel border bg-surface ${flagged ? "border-halt/50" : "border-line"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-bold">{title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span>{result.status === "SOLD" ? `Paddle ${result.winnerAlias}, ${result.bidCount} bids` : "No sale"}</span>
            <span>{shortDateTime(result.closedAtMs)}</span>
            {v ? (
              <span className={`inline-flex items-center gap-1 font-semibold ${v.allOk ? "text-live" : "text-halt"}`}>
                <CheckMark ok={v.allOk} />
                {v.allOk ? "All checks pass" : v.issuer.ok ? "Check failed" : "Unverified issuer"}
              </span>
            ) : (
              <span>Checking…</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className={`font-narrow tabular text-3xl font-extrabold ${flagged ? "text-ink-3 line-through decoration-halt/60" : ""}`}>
            {result.status === "SOLD" ? formatMinor(result.hammerPriceMinor) : "Unsold"}
          </span>
          <svg viewBox="0 0 16 16" className={`size-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-5 py-4">
          {v ? (
            <ul className="flex flex-col gap-3">
              {[v.issuer, v.rules, v.history, v.ladder, v.transcript].map((check, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5">
                    <CheckMark ok={check.ok} />
                  </span>
                  <span>
                    <span className="font-semibold">{check.label}</span>
                    <span className="block break-words text-sm text-ink-2">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-sm">
            <Link href={`/auction/${result.auctionId}/bids`} className="font-semibold text-cobalt hover:underline">
              See every bid
            </Link>
            <a href={explorerEntityUrl(result.key)} target="_blank" rel="noreferrer" className="tabular text-cobalt hover:underline">
              Result entity {shortKey(result.key)}
            </a>
          </div>
        </div>
      ) : null}
    </article>
  );
}
