"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BidLedger } from "@/components/auction/bid-ledger";
import { HammerBar } from "@/components/auction/hammer-bar";
import { HealthStrip } from "@/components/auction/health-strip";
import { PaddleRoster } from "@/components/auction/paddle-roster";
import { PaymentStatus } from "@/components/auction/payment-status";
import { phaseHeadline, priceLabel } from "@/components/auction/phase-copy";
import { PriceDisplay } from "@/components/auction/price-display";
import { Button, Container, LotTag, Panel, Skeleton, SourceBadge } from "@/components/ui";
import { formatMinor, percentFromBps, secondsLabel } from "@/lib/format";
import type { Phase } from "@/lib/types";
import { useAuctionStream, useCountdown } from "@/lib/use-auction-stream";
import { useLatestSnapshot, useListingByAuction } from "@/lib/use-arkiv";
import { useEngineHealth } from "@/lib/use-featured-auction";
import { SimulationControls } from "./simulation-controls";

const CLOSED_PHASES: ReadonlySet<Phase> = new Set<Phase>(["SOLD_LOCKED", "UNSOLD", "CANCELLED"]);

export function RoomView({ auctionId: requestedId }: { auctionId: string }) {
  // The lot this room follows. It starts as the one in the URL. If this page watched that lot live
  // and the engine opens a new one after it closes, the room moves to the new lot in place, without
  // a page navigation, so a big screen (even in full screen) keeps up without anyone touching it.
  // Someone who opens an old lot's room (from Results, say) gets a link to the live lot instead.
  const [auctionId, setAuctionId] = useState(requestedId);
  const [watchedLive, setWatchedLive] = useState(false);
  const [requested, setRequested] = useState(requestedId);
  if (requested !== requestedId) {
    setRequested(requestedId);
    setAuctionId(requestedId);
    setWatchedLive(false);
  }

  const stream = useAuctionStream(auctionId);
  const { state, bids, source, connection, clockOffsetMs, simulator, lastBidSeq } = stream;
  // Until the new lot's first snapshot arrives, the state on screen still belongs to the old lot,
  // so everything shown alongside it (title, snapshot, links) uses the state's own auctionId.
  const shownId = state?.auctionId ?? auctionId;
  const msLeft = useCountdown(state, clockOffsetMs);
  const listing = useListingByAuction(shownId);
  const streamDown = source === "engine" && connection !== "open";
  const snapshot = useLatestSnapshot(shownId, streamDown);

  const activeAuctionId = useEngineHealth().data?.activeAuctionId ?? null;
  const current = !!state && state.auctionId === auctionId;
  const closed = current && CLOSED_PHASES.has(state.phase);
  if (current && !closed && !watchedLive) setWatchedLive(true);
  const newerLot = closed && activeAuctionId && activeAuctionId !== auctionId ? activeAuctionId : null;
  if (newerLot && watchedLive) setAuctionId(newerLot);

  useEffect(() => {
    // Keep the address bar on the lot being followed. The native history API updates the URL
    // without a navigation, so the room isn't remounted and full screen survives.
    const path = `/room/${encodeURIComponent(auctionId)}`;
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
  }, [auctionId]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }, []);

  if (!state) {
    return (
      <Container className="py-8">
        <Skeleton className="h-[30rem] w-full rounded-stage" />
      </Container>
    );
  }

  const sold = state.phase === "SOLD_LOCKED";
  const paused = state.phase === "PAUSED";
  const secondsLeft = state.phase === "COUNTDOWN" && msLeft !== null ? Math.ceil(msLeft / 1000) : null;
  const lot = listing.data;

  return (
    <Container className="py-6 sm:py-8">
      <div
        ref={stageRef}
        className={`relative overflow-hidden rounded-stage border border-line bg-surface ${isFullscreen ? "flex h-full flex-col justify-center rounded-none border-0 p-[4vw]" : "p-5 sm:p-8 lg:p-10"}`}
      >
        {/* top row */}
        <div className="flex flex-wrap items-center gap-3">
          {lot ? <LotTag lot={lot.lotNumber} size="lg" /> : null}
          {lot ? <span className="text-ink-2">{lot.category}</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <SourceBadge source={source} />
            <Button variant="quiet" size="sm" className="hidden sm:inline-flex" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </Button>
          </div>
        </div>

        <h1 className="mt-4 max-w-4xl text-2xl font-bold sm:text-4xl">
          {lot?.title ?? (listing.isLoading ? <Skeleton className="h-10 w-2/3" /> : `Auction ${shownId}`)}
        </h1>

        <div className="mt-8 grid gap-10 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          {/* the board */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-lg font-semibold text-ink-2">{priceLabel(state)}</p>
              {secondsLeft !== null ? (
                <p className="font-narrow tabular text-5xl font-extrabold leading-none sm:text-6xl" aria-hidden>
                  {secondsLeft}
                  <span className="ml-1 text-lg font-semibold text-ink-3">s</span>
                </p>
              ) : null}
            </div>

            <div className="mt-2">
              <PriceDisplay priceMinor={state.priceMinor} unit={state.rules.unit} bidSeq={lastBidSeq} sold={sold} />
            </div>

            <p
              className={`mt-5 text-xl font-semibold sm:text-2xl ${paused ? "text-halt" : "text-ink"}`}
              role="status"
              aria-live="polite"
            >
              {phaseHeadline(state)}
              {sold && state.result ? (
                <span className="font-normal text-ink-2"> for {formatMinor(state.result.hammerPriceMinor)}</span>
              ) : null}
            </p>
            {state.phase === "COUNTDOWN" ? (
              <p className="mt-1 text-ink-2">
                Next bid <span className="tabular font-semibold text-ink">{formatMinor(state.nextPriceMinor)}</span>. Any other
                switched-on paddle can press to take the lead.
              </p>
            ) : null}
            {paused && state.pauseReason ? <p className="mt-1 text-ink-2">{state.pauseReason}</p> : null}
            {sold ? <PaymentStatus auctionId={shownId} className="mt-4" /> : null}

            <div className="mt-8">
              <HammerBar state={state} msLeft={msLeft} />
            </div>
          </div>

          {/* paddles + rules */}
          <aside className="flex flex-col gap-8">
            <div>
              <h2 className="mb-3 text-base font-bold">Paddles in the room</h2>
              <PaddleRoster paddles={state.paddles} leaderAlias={state.leaderAlias} />
            </div>
            <div>
              <h2 className="mb-3 text-base font-bold">Rules for this lot</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">Opening bid</dt>
                <dd className="tabular text-right font-semibold">{formatMinor(state.rules.startPriceMinor)}</dd>
                <dt className="text-ink-3">Each bid adds</dt>
                <dd className="tabular text-right font-semibold">{percentFromBps(state.rules.stepBps)}</dd>
                <dt className="text-ink-3">Hammer after</dt>
                <dd className="tabular text-right font-semibold">{secondsLabel(state.rules.countdownMs)}</dd>
                <dt className="text-ink-3">Ceiling</dt>
                <dd className="tabular text-right font-semibold">{formatMinor(state.rules.ceilingMinor)}</dd>
              </dl>
            </div>
          </aside>
        </div>

        {newerLot && !watchedLive ? (
          <div className="mt-8 rounded-panel border border-cobalt/40 bg-cobalt-soft px-4 py-3 text-sm" role="status">
            <p className="font-semibold">This lot has closed. A newer lot is live now.</p>
            <Link href={`/room/${encodeURIComponent(newerLot)}`} className="mt-0.5 inline-block font-semibold text-cobalt hover:underline">
              Go to the live room
            </Link>
          </div>
        ) : null}

        {streamDown ? (
          <div className="mt-8 rounded-panel border border-halt/40 bg-halt-soft px-4 py-3 text-sm" role="alert">
            <p className="font-semibold text-halt">Reconnecting to the room…</p>
            {snapshot.data ? (
              <p className="mt-0.5 text-ink-2">
                Last public snapshot on Arkiv: {formatMinor(snapshot.data.priceMinor)}
                {snapshot.data.leaderAlias ? `, Paddle ${snapshot.data.leaderAlias} leading` : ""}. Live bidding is paused until the
                stream returns.
              </p>
            ) : (
              <p className="mt-0.5 text-ink-2">Live bidding is paused until the stream returns.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <Panel>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold">Bids</h2>
            <Link href={`/auction/${encodeURIComponent(shownId)}/bids`} className="text-sm font-semibold text-cobalt hover:underline">
              Full history on Arkiv
            </Link>
          </div>
          <BidLedger bids={bids} lastBidSeq={lastBidSeq} leaderAlias={state.leaderAlias} sold={sold} />
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel className="px-5 py-4">
            <h2 className="mb-4 text-base font-bold">Room status</h2>
            <HealthStrip state={state} clockOffsetMs={clockOffsetMs} />
          </Panel>
          {simulator ? <SimulationControls simulator={simulator} state={state} /> : null}
        </div>
      </div>
    </Container>
  );
}
