"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Button, buttonClass, LotTag, PageHeader, Panel, Pill } from "@/components/ui";
import type { Listing } from "@/lib/arkiv";
import { isSimulation } from "@/lib/config";
import { formatMinor } from "@/lib/format";
import { LOT_STATE_ORDER, lotStateLine, useEngineLots, useLotStates, type LotState } from "@/lib/lot-state";
import { useListings } from "@/lib/use-arkiv";

/** Must match NO_BID_LIMITS_MS in lib/admin/server.ts. */
const NO_BID_TIMERS = [
  { ms: 60_000, label: "1 min" },
  { ms: 120_000, label: "2 min" },
  { ms: 300_000, label: "5 min" },
  { ms: 600_000, label: "10 min" },
];

const OPEN_PHASES = new Set(["LOBBY", "OPEN", "COUNTDOWN", "PAUSED"]);

const PILL: Record<LotState["kind"], { label: string; tone: "live" | "cobalt" | "paddle" | "neutral" }> = {
  live: { label: "Live now", tone: "live" },
  upNext: { label: "Up next", tone: "cobalt" },
  sold: { label: "Sold", tone: "paddle" },
  unsold: { label: "Unsold", tone: "neutral" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

type Reply = { ok: true; phase?: string } | { ok: false; status: number; error: string };

async function adminPost(path: string, password: string, body: unknown = {}): Promise<Reply> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "x-admin-password": password, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; phase?: string };
    return response.ok ? { ok: true, phase: data.phase } : { ok: false, status: response.status, error: data.error ?? `The server answered ${response.status}.` };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the website's server." };
  }
}

export function AdminView() {
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const onSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError(null);
    const reply = await adminPost("/api/admin/login", password);
    setChecking(false);
    if (reply.ok) setSignedIn(true);
    else setError(reply.error);
  };

  if (signedIn) {
    return (
      <Console
        password={password}
        onSignOut={(why) => {
          setSignedIn(false);
          setError(why ?? null);
        }}
      />
    );
  }

  return (
    <>
      <PageHeader title="Auctioneer" lede="Open bidding on the lots, one at a time. Only the auctioneer can start or withdraw a lot." />
      <Panel className="max-w-md p-6">
        <form onSubmit={onSignIn} className="flex flex-col gap-4">
          <label htmlFor={fieldId} className="text-sm font-semibold">
            Admin password
          </label>
          <input
            id={fieldId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-surface-2 px-3 text-ink focus:border-cobalt focus:bg-surface focus:outline-none"
          />
          <Button type="submit" disabled={!password || checking}>
            {checking ? "Checking…" : "Sign in"}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-halt">
              {error}
            </p>
          ) : null}
        </form>
      </Panel>
    </>
  );
}

function Console({ password, onSignOut }: { password: string; onSignOut: (why?: string) => void }) {
  const queryClient = useQueryClient();
  const listings = useListings({});
  const engineLots = useEngineLots();
  const { states, engineReachable } = useLotStates(listings.data);
  const [timerMs, setTimerMs] = useState(120_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; roomId?: string } | null>(null);

  // The lot on the block, straight from the engine (it may have no listing, e.g. a test lot).
  const running = (engineLots.data ?? []).find((lot) => OPEN_PHASES.has(lot.phase)) ?? null;
  const runningListing = running ? listings.data?.find((l) => l.auctionId === running.auctionId) : undefined;

  const rows = useMemo(
    () =>
      (listings.data ?? [])
        .map((l, i) => ({ l, i, state: states.get(l.auctionId) }))
        .sort((a, b) => (a.state ? LOT_STATE_ORDER[a.state.kind] : 9) - (b.state ? LOT_STATE_ORDER[b.state.kind] : 9) || a.l.lotNumber - b.l.lotNumber || a.i - b.i),
    [listings.data, states],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["engine"] });
    void queryClient.invalidateQueries({ queryKey: ["arkiv", "results"] });
  };

  const handleFailure = (reply: Extract<Reply, { ok: false }>) => {
    if (reply.status === 401) onSignOut("Signed out: the admin password changed or was wrong.");
    else setNotice({ tone: "error", text: reply.error });
  };

  const start = async (listing: Listing) => {
    setBusy(listing.auctionId);
    setNotice(null);
    const reply = await adminPost("/api/admin/start", password, {
      auctionId: listing.auctionId,
      listingId: listing.listingId,
      category: listing.category,
      startPriceMinor: listing.startPriceMinor,
      timeLimitMs: timerMs,
    });
    setBusy(null);
    if (!reply.ok) return handleFailure(reply);
    setNotice({
      tone: "ok",
      text: `Bidding is open for Lot ${String(listing.lotNumber).padStart(2, "0")}, ${listing.title}. Paddles that switch on can bid now. With no bid in ${timerMs / 60_000} min it goes back to the seller.`,
      roomId: listing.auctionId,
    });
    refresh();
  };

  const cancel = async (auctionId: string) => {
    if (!window.confirm(`Withdraw ${auctionId}? Bidding stops at once and the lot closes as withdrawn.`)) return;
    setBusy(auctionId);
    setNotice(null);
    const reply = await adminPost("/api/admin/cancel", password, { auctionId });
    setBusy(null);
    if (!reply.ok) return handleFailure(reply);
    setNotice({ tone: "ok", text: `${auctionId} was withdrawn.` });
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Auctioneer"
        lede="Open bidding on one lot at a time. Paddles that switch on can bid straight away, and a lone bidder wins at their bid. With no bid before the timer runs out, the lot goes back to its seller."
        aside={
          <Button variant="quiet" size="sm" onClick={() => onSignOut()}>
            Sign out
          </Button>
        }
      />

      {isSimulation ? (
        <p role="alert" className="mb-6 rounded-panel border border-halt/40 bg-halt-soft px-4 py-3 text-sm">
          No engine is configured for this site (NEXT_PUBLIC_ENGINE_WS_URL), so lots can&apos;t be started.
        </p>
      ) : !engineReachable && engineLots.isFetched ? (
        <p role="alert" className="mb-6 rounded-panel border border-halt/40 bg-halt-soft px-4 py-3 text-sm">
          This browser can&apos;t reach the engine, so the statuses below may be out of date. Check the laptop and the tunnel.
        </p>
      ) : null}

      <Panel className="p-5 sm:p-6">
        <h2 className="text-base font-bold">On the block</h2>
        {running ? (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {runningListing ? <LotTag lot={runningListing.lotNumber} size="md" /> : null}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{runningListing?.title ?? running.auctionId}</p>
              <p className="text-sm text-ink-2">
                {running.phase === "PAUSED"
                  ? "Paused: the gateway or bridge is down"
                  : running.bidCount === 0
                    ? "Bidding is open, no bids yet"
                    : `${running.bidCount} ${running.bidCount === 1 ? "bid" : "bids"}, Paddle ${running.leaderAlias} at ${formatMinor(running.priceMinor)}`}
              </p>
            </div>
            <Link href={`/room/${encodeURIComponent(running.auctionId)}`} className={buttonClass("outline", "md")}>
              Open the room
            </Link>
            <Button variant="danger" disabled={busy !== null} onClick={() => cancel(running.auctionId)}>
              {busy === running.auctionId ? "Withdrawing…" : "Withdraw lot"}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-ink-2">Nothing is running. Pick a lot below to open bidding.</p>
        )}
      </Panel>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-semibold">If nobody bids, return the lot to its seller after</legend>
        <div className="flex flex-wrap gap-2">
          {NO_BID_TIMERS.map((t) => (
            <button
              key={t.ms}
              type="button"
              aria-pressed={timerMs === t.ms}
              onClick={() => setTimerMs(t.ms)}
              className="tabular h-10 min-w-16 rounded-lg border border-line bg-surface-2 px-3 font-semibold text-ink-2 hover:border-line-strong aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-wall"
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-6 rounded-panel border px-4 py-3 text-sm ${notice.tone === "error" ? "border-halt/40 bg-halt-soft" : "border-live/40 bg-live-soft"}`}
        >
          <p className="font-semibold">{notice.text}</p>
          {notice.roomId ? (
            <Link href={`/room/${encodeURIComponent(notice.roomId)}`} className="mt-1 inline-block font-semibold text-cobalt hover:underline">
              Go to the live room
            </Link>
          ) : null}
        </div>
      ) : null}

      <h2 className="mt-10 text-base font-bold">Lots</h2>
      {listings.isError ? (
        <p role="alert" className="mt-3 text-sm text-halt">
          Arkiv didn&apos;t answer. Retry in a moment.
        </p>
      ) : !listings.data ? (
        <p className="mt-3 text-sm text-ink-3">Loading lots…</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
          {rows.map(({ l, state }) => (
            <li key={l.key} className="flex flex-wrap items-center gap-4 px-4 py-3 sm:px-5">
              <LotTag lot={l.lotNumber} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{l.title}</p>
                <p className="text-sm text-ink-3">
                  {l.sellerAlias} · opens at {formatMinor(l.startPriceMinor)}
                  {state && state.kind !== "upNext" ? ` · ${lotStateLine(state)}` : ""}
                </p>
              </div>
              {state ? <Pill tone={PILL[state.kind].tone}>{PILL[state.kind].label}</Pill> : null}
              {state?.kind === "upNext" ? (
                <Button
                  variant="paddle"
                  size="sm"
                  disabled={busy !== null || running !== null || isSimulation}
                  title={running ? "Another lot is still running" : undefined}
                  onClick={() => start(l)}
                >
                  {busy === l.auctionId ? "Opening…" : "Open bidding"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
