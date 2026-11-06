"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { Button, buttonClass, CheckMark, LotTag, PageHeader, Panel, Pill, SourceBadge } from "@/components/ui";
import { WalletButton } from "@/components/wallet-button";
import { publishListing, type PublishOutcome } from "@/lib/arkiv/write-listing";
import { explorerEntityUrl, isSampleArkiv } from "@/lib/config";
import { formatMinor, shortKey } from "@/lib/format";
import { lotStateLine, useLotStates, type LotState } from "@/lib/lot-state";
import { useListings } from "@/lib/use-arkiv";

const CATEGORIES = ["Electronics", "Watches", "Cameras", "Textiles", "Craft", "Music", "Collectibles", "Other"];
/** Listings stay up a week, so a lot can wait for the auctioneer. */
const LISTED_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const PILL: Record<LotState["kind"], { label: string; tone: "live" | "cobalt" | "paddle" | "neutral" }> = {
  live: { label: "Live now", tone: "live" },
  upNext: { label: "Up next", tone: "cobalt" },
  sold: { label: "Sold", tone: "paddle" },
  unpaid: { label: "Back with you", tone: "neutral" },
  unsold: { label: "Back with you", tone: "neutral" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

const toMinor = (text: string) => {
  const v = Number.parseFloat(text);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};

/** A fresh, unguessable suffix per listing, so nobody can write a look-alike listing for it first. */
function newLotSuffix() {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join("");
  return `${Date.now().toString(36)}${random}`;
}

/**
 * Any connected wallet can list an item. The listing is an ItemListing entity owned by that wallet;
 * it shows up in Lots for everyone, and the auctioneer opens bidding on it from the admin page with the
 * house rules (the seller sets the opening bid). The seller follows each lot's outcome under "Your lots".
 */
export function SellerFlow() {
  const { address, isConnected } = useAccount();
  const ids = { title: useId(), category: useId(), condition: useId(), description: useId(), start: useId() };
  const [item, setItem] = useState({ title: "", category: "Electronics", condition: "", description: "" });
  const [startText, setStartText] = useState("100.00");
  const [published, setPublished] = useState<(PublishOutcome & { lotNumber: number; title: string }) | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const all = useListings({});
  const startMinor = toMinor(startText);
  const valid = item.title.trim().length >= 3 && item.condition.trim().length > 0 && startMinor !== null;
  // Next lot number after every listing on Arkiv (demo lots use 11-16).
  const nextLot = Math.max(16, ...(all.data ?? []).map((l) => l.lotNumber)) + 1;

  const mine = useMemo(
    () => (address ? (all.data ?? []).filter((l) => l.owner.toLowerCase() === address.toLowerCase()) : []),
    [all.data, address],
  );
  const { states } = useLotStates(mine);

  const onPublish = async () => {
    if (!address || startMinor === null) return;
    setPublishing(true);
    setPublishError(null);
    const suffix = newLotSuffix();
    const title = item.title.trim();
    try {
      const outcome = await publishListing(
        {
          listingId: `lot-${suffix}`,
          lotNumber: nextLot,
          auctionId: `bid3-${suffix}`,
          title,
          category: item.category,
          condition: item.condition.trim(),
          description: item.description.trim(),
          sellerAlias: `Seller ${address.slice(2, 6)}`,
          startPriceMinor: startMinor,
          closesAtMs: Date.now() + LISTED_FOR_MS,
        },
        address,
      );
      setPublished({ ...outcome, lotNumber: nextLot, title });
      setItem({ title: "", category: item.category, condition: "", description: "" });
      void all.refetch();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "The wallet didn't sign the listing.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sell an item"
        lede="List it from your own wallet and it appears in Lots for everyone. The auctioneer opens bidding on it; if nobody bids in time, it comes back to you."
        aside={<SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel className="p-5 sm:p-8">
          <StepBody title="What are you selling?" lede="This becomes an ItemListing entity on Arkiv, owned by your wallet, not by Bid3.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Title" htmlFor={ids.title} className="sm:col-span-2">
                <input
                  id={ids.title}
                  value={item.title}
                  onChange={(e) => setItem({ ...item, title: e.target.value })}
                  placeholder="Hand-wired split keyboard, 42 keys"
                  className={inputClass}
                />
              </Field>
              <Field label="Category" htmlFor={ids.category}>
                <select id={ids.category} value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })} className={inputClass}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Condition" htmlFor={ids.condition}>
                <input
                  id={ids.condition}
                  value={item.condition}
                  onChange={(e) => setItem({ ...item, condition: e.target.value })}
                  placeholder="Works, small scratch on the case"
                  className={inputClass}
                />
              </Field>
              <Field label="Opening bid" htmlFor={ids.start} hint="In demo credits. Each bid then adds 5%, and the hammer falls 10 s after the last bid.">
                <input id={ids.start} inputMode="decimal" value={startText} onChange={(e) => setStartText(e.target.value)} className={`${inputClass} tabular`} />
              </Field>
              <Field label="Description" htmlFor={ids.description} className="sm:col-span-2" hint="Optional. Plain text, shown on the lot page.">
                <textarea
                  id={ids.description}
                  rows={4}
                  value={item.description}
                  onChange={(e) => setItem({ ...item, description: e.target.value })}
                  className={`${inputClass} h-auto py-2.5`}
                />
              </Field>
            </div>

            <div className="mt-8 rounded-panel border border-line bg-surface-2 p-5">
              {isConnected ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="max-w-md text-sm text-ink-2">
                    Your wallet signs the write, so the listing is yours. It costs a little testnet gas (tGLM) on Arkiv&apos;s Rabdi network:{" "}
                    <a href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer" className="font-semibold text-cobalt hover:underline">
                      free from the faucet
                    </a>
                    .
                  </p>
                  <Button onClick={onPublish} disabled={!valid || publishing}>
                    {publishing ? "Waiting for your wallet…" : "Publish listing"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="max-w-md text-sm text-ink-2">Connect the wallet that should own this listing.</p>
                  <WalletButton size="md" />
                </div>
              )}
              {publishError ? (
                <p role="alert" className="mt-3 text-sm text-halt">
                  {publishError}
                </p>
              ) : null}
              {!valid && isConnected ? <p className="mt-3 text-sm text-ink-3">Add a title, the condition and an opening bid above zero.</p> : null}
            </div>

            {published ? (
              <div role="status" className="mt-6 rounded-panel border border-live/40 bg-live-soft p-5">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckMark ok /> {published.simulated ? "Listing prepared (sample mode, nothing sent)" : `Listed as Lot ${String(published.lotNumber).padStart(2, "0")}`}
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  {published.title} is in Lots for everyone now. The auctioneer opens bidding on it; you&apos;ll see how it goes under Your lots.{" "}
                  {published.simulated ? null : (
                    <>
                      Entity{" "}
                      <a className="tabular text-cobalt hover:underline" href={explorerEntityUrl(published.entityKey)} target="_blank" rel="noreferrer">
                        {shortKey(published.entityKey)}
                      </a>
                      .
                    </>
                  )}
                </p>
                <Link href="/catalogue" className={buttonClass("outline", "md", "mt-4")}>
                  See it in Lots
                </Link>
              </div>
            ) : null}
          </StepBody>
        </Panel>

        <Panel className="self-start p-5">
          <h2 className="text-base font-bold">Your lots</h2>
          {!isConnected ? (
            <p className="mt-2 text-sm text-ink-2">Connect your wallet to follow your listings.</p>
          ) : mine.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">{all.data ? "Nothing listed from this wallet yet." : "Loading…"}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {mine.map((l) => {
                const state = states.get(l.auctionId);
                return (
                  <li key={l.key} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <LotTag lot={l.lotNumber} size="sm" />
                      {state ? <Pill tone={PILL[state.kind].tone}>{PILL[state.kind].label}</Pill> : null}
                    </div>
                    <p className="mt-2 font-semibold leading-snug">{l.title}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {state
                        ? state.kind === "unsold"
                          ? "No bids in time, so it's back with you. List it again any time."
                          : state.kind === "unpaid"
                            ? `Paddle ${state.winnerAlias} won but didn't pay (${state.reason.toLowerCase()}), so it stays with you.`
                            : lotStateLine(state)
                        : `Opens at ${formatMinor(l.startPriceMinor)}`}
                    </p>
                    {state?.kind === "live" ? (
                      <Link href={`/room/${encodeURIComponent(l.auctionId)}`} className="mt-1 inline-block text-sm font-semibold text-cobalt hover:underline">
                        Watch the room
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-line bg-surface-2 px-3 text-ink placeholder:text-ink-3 focus:border-cobalt focus:bg-surface focus:outline-none";

function StepBody({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-2 max-w-2xl text-ink-2">{lede}</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function Field({ label, htmlFor, hint, className = "", children }: { label: string; htmlFor: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-sm text-ink-3">{hint}</p> : null}
    </div>
  );
}
