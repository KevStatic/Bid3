"use client";

import { useId, useMemo, useState } from "react";
import { LotCard } from "@/components/lot-card";
import { QueryDisclosure } from "@/components/query-disclosure";
import { Button, PageHeader, Skeleton, SourceBadge } from "@/components/ui";
import type { ListingFilter, ListingSort } from "@/lib/arkiv";
import { listingQueryText } from "@/lib/arkiv/query-text";
import { isSampleArkiv } from "@/lib/config";
import { LOT_STATE_ORDER, useLotStates, type LotState } from "@/lib/lot-state";
import { useListings } from "@/lib/use-arkiv";
import { useNow } from "@/lib/use-now";

/** Status chips filter on where each lot really stands (see lib/lot-state), not on the listing's own status field. */
type StatusChip = "live" | "upNext" | "closed" | undefined;
const STATUSES: { value: StatusChip; label: string }[] = [
  { value: undefined, label: "All lots" },
  { value: "live", label: "Live now" },
  { value: "upNext", label: "Up next" },
  { value: "closed", label: "Sold or unsold" },
];
const matches = (chip: StatusChip, state: LotState | undefined) =>
  !chip || !state ? !chip : chip === "closed" ? state.kind === "sold" || state.kind === "unsold" || state.kind === "cancelled" : state.kind === chip;

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
  const [status, setStatus] = useState<StatusChip>(undefined);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [sort, setSort] = useState<ListingSort>("closing");
  const nowMs = useNow();
  const ids = { min: useId(), max: useId(), sort: useId() };

  const filter: ListingFilter = useMemo(
    () => ({ category, minStartMinor: toMinor(minText), maxStartMinor: toMinor(maxText), sort }),
    [category, minText, maxText, sort],
  );

  const all = useListings({});
  const listings = useListings(filter);
  const categories = useMemo(() => [...new Set((all.data ?? []).map((l) => l.category))].sort(), [all.data]);
  const { states } = useLotStates(listings.data);
  // Live lots first, then up next, then closed; the chosen sort holds within each group.
  const visible = useMemo(
    () =>
      listings.data
        ?.filter((l) => matches(status, states.get(l.auctionId)))
        .map((l, i) => ({ l, i }))
        .sort((a, b) => {
          const sa = states.get(a.l.auctionId);
          const sb = states.get(b.l.auctionId);
          return (sa ? LOT_STATE_ORDER[sa.kind] : 9) - (sb ? LOT_STATE_ORDER[sb.kind] : 9) || a.i - b.i;
        })
        .map(({ l }) => l),
    [listings.data, states, status],
  );
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
        lede="Every listing here is an Arkiv entity owned by its seller's wallet. Category and price filters run as Arkiv queries, not against our server. Whether a lot is live, up next or sold comes from the room and its published result."
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
          {visible ? `${visible.length} ${visible.length === 1 ? "lot" : "lots"}` : "Loading lots…"}
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
      ) : visible && visible.length === 0 ? (
        <div className="mt-4 rounded-panel border border-dashed border-line-strong p-10 text-center">
          <p className="text-lg font-semibold">No lots match these filters</p>
          <p className="mt-1 text-ink-2">Widen the price range or pick another category.</p>
          <Button className="mt-4" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : (
        <ul className={`mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${listings.isFetching ? "opacity-70" : ""}`}>
          {visible
            ? visible.map((l) => (
                <li key={l.key}>
                  <LotCard listing={l} nowMs={nowMs} state={states.get(l.auctionId)} />
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
