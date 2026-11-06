"use client";

import { useId, useMemo, useState } from "react";
import { LotCard } from "@/components/lot-card";
import { QueryDisclosure } from "@/components/query-disclosure";
import { Button, PageHeader, Skeleton, SourceBadge } from "@/components/ui";
import type { ListingFilter, ListingSort, ListingStatus } from "@/lib/arkiv";
import { listingQueryText } from "@/lib/arkiv/query-text";
import { isSampleArkiv } from "@/lib/config";
import { useListings } from "@/lib/use-arkiv";
import { useNow } from "@/lib/use-now";

const STATUSES: { value: ListingStatus | undefined; label: string }[] = [
  { value: undefined, label: "All lots" },
  { value: "OPEN", label: "Bidding now" },
  { value: "UPCOMING", label: "Opens soon" },
  { value: "CLOSED", label: "Closed" },
];

const SORTS: { value: ListingSort; label: string }[] = [
  { value: "closing", label: "Closing soonest" },
  { value: "price-asc", label: "Opening bid, low to high" },
  { value: "price-desc", label: "Opening bid, high to low" },
  { value: "lot", label: "Lot number" },
];

const toMinor = (text: string) => {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : undefined;
};

export function CatalogueView() {
  const [status, setStatus] = useState<ListingStatus | undefined>(undefined);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [sort, setSort] = useState<ListingSort>("closing");
  const nowMs = useNow();
  const ids = { min: useId(), max: useId(), sort: useId() };

  const filter: ListingFilter = useMemo(
    () => ({ status, category, minStartMinor: toMinor(minText), maxStartMinor: toMinor(maxText), sort }),
    [status, category, minText, maxText, sort],
  );

  const all = useListings({});
  const listings = useListings(filter);
  const categories = useMemo(() => [...new Set((all.data ?? []).map((l) => l.category))].sort(), [all.data]);
  const filtersActive = status || category || minText || maxText;

  const clear = () => {
    setStatus(undefined);
    setCategory(undefined);
    setMinText("");
    setMaxText("");
  };

  return (
    <>
      <PageHeader
        title="Lots"
        lede="Every listing here is an Arkiv entity owned by its seller's wallet. Filters run as Arkiv queries, not against our server."
        aside={<SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />}
      />

      <div className="flex flex-col gap-5 rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s.label}
              type="button"
              aria-pressed={status === s.value}
              onClick={() => setStatus(s.value)}
              className="h-9 rounded-full border border-line px-4 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-wall"
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-ink-3">Category</span>
            <button
              type="button"
              aria-pressed={!category}
              onClick={() => setCategory(undefined)}
              className="h-8 rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 aria-pressed:bg-paddle-soft aria-pressed:text-ink"
            >
              Any
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? undefined : c)}
                className="h-8 rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 aria-pressed:bg-paddle-soft aria-pressed:text-ink"
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-4">
          <fieldset className="flex items-end gap-2">
            <legend className="sr-only">Opening bid range</legend>
            <label htmlFor={ids.min} className="flex flex-col text-sm text-ink-3">
              Opening bid from
              <input
                id={ids.min}
                inputMode="decimal"
                placeholder="0"
                value={minText}
                onChange={(e) => setMinText(e.target.value)}
                className="tabular mt-1 h-9 w-28 rounded-md border border-line bg-surface-2 px-2.5 text-ink placeholder:text-ink-3 focus:border-cobalt focus:outline-none"
              />
            </label>
            <label htmlFor={ids.max} className="flex flex-col text-sm text-ink-3">
              to
              <input
                id={ids.max}
                inputMode="decimal"
                placeholder="Any"
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className="tabular mt-1 h-9 w-28 rounded-md border border-line bg-surface-2 px-2.5 text-ink placeholder:text-ink-3 focus:border-cobalt focus:outline-none"
              />
            </label>
          </fieldset>

          <label htmlFor={ids.sort} className="flex flex-col text-sm text-ink-3">
            Sort
            <select
              id={ids.sort}
              value={sort}
              onChange={(e) => setSort(e.target.value as ListingSort)}
              className="mt-1 h-9 rounded-md border border-line bg-surface-2 px-2.5 text-ink focus:border-cobalt focus:outline-none"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <QueryDisclosure query={listingQueryText(filter)} />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-ink-3" aria-live="polite">
          {listings.data ? `${listings.data.length} ${listings.data.length === 1 ? "lot" : "lots"}` : "Loading lots…"}
        </p>
        {filtersActive ? (
          <Button variant="quiet" size="sm" onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {listings.isError ? (
        <div className="mt-4 rounded-panel border border-halt/40 bg-halt-soft p-5" role="alert">
          <p className="font-semibold text-halt">Arkiv didn&apos;t answer.</p>
          <p className="mt-1 text-ink-2">Check the access key and network, then retry.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => listings.refetch()}>
            Retry
          </Button>
        </div>
      ) : listings.data && listings.data.length === 0 ? (
        <div className="mt-4 rounded-panel border border-dashed border-line-strong p-10 text-center">
          <p className="text-lg font-semibold">No lots match these filters</p>
          <p className="mt-1 text-ink-2">Widen the price range or pick another category.</p>
          <Button className="mt-4" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : (
        <ul className={`mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${listings.isFetching ? "opacity-70" : ""}`}>
          {listings.data
            ? listings.data.map((l) => (
                <li key={l.key}>
                  <LotCard listing={l} nowMs={nowMs} />
                </li>
              ))
            : Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <Skeleton className="h-80 w-full rounded-panel" />
                </li>
              ))}
        </ul>
      )}
    </>
  );
}
