"use client";

import Link from "next/link";
import { HammerBar } from "@/components/auction/hammer-bar";
import { PriceDisplay } from "@/components/auction/price-display";
import { TagIllustration } from "@/components/tag-illustration";
import { buttonClass, LotTag, Skeleton, SourceBadge } from "@/components/ui";
import { config } from "@/lib/config";
import { formatMinor } from "@/lib/format";
import { useAuctionStream, useCountdown } from "@/lib/use-auction-stream";
import { useListingByAuction } from "@/lib/use-arkiv";

const LIGHTS = [
  { look: "Slow pulse", meaning: "Joining the room" },
  { look: "Steady glow", meaning: "You're in and can bid" },
  { look: "One quick blink", meaning: "Your bid was accepted" },
  { look: "Two blinks", meaning: "You're leading" },
  { look: "Three fast blinks", meaning: "Press refused: someone bid first, or the lot closed" },
  { look: "Off", meaning: "Switched off" },
];

export function SeatView({ alias }: { alias: string }) {
  const auctionId = config.featuredAuctionId;
  const { state, source, clockOffsetMs, lastBidSeq } = useAuctionStream(auctionId);
  const msLeft = useCountdown(state, clockOffsetMs);
  const { data: lot } = useListingByAuction(auctionId);

  const me = state?.paddles.find((p) => p.alias === alias);
  const leading = state?.leaderAlias === alias;
  const won = state?.phase === "SOLD_LOCKED" && state.result?.winnerAlias === alias;

  let status: { text: string; tone: string };
  if (!state) status = { text: "Connecting…", tone: "text-ink-3" };
  else if (!me) status = { text: `Paddle ${alias} isn't in this round`, tone: "text-ink-2" };
  else if (won) status = { text: "You won this lot", tone: "text-ink" };
  else if (state.phase === "SOLD_LOCKED") status = { text: `Sold to Paddle ${state.result?.winnerAlias}`, tone: "text-ink-2" };
  else if (leading) status = { text: "You're leading", tone: "text-ink" };
  else if (me.status === "ACTIVE") status = { text: state.phase === "LOBBY" ? "You're in. Waiting for another paddle." : "You're in. Press BID to raise.", tone: "text-live" };
  else if (me.status === "UNKNOWN") status = { text: "Signal lost. Hold the tag closer to the gateway.", tone: "text-halt" };
  else status = { text: "Switched off. Slide the switch to join.", tone: "text-ink-2" };

  return (
    <div className="py-6 sm:py-10">
      <div className="flex items-center justify-between gap-3">
        {lot ? <LotTag lot={lot.lotNumber} /> : <Skeleton className="h-7 w-16" />}
        <SourceBadge source={source} />
      </div>
      <p className="mt-3 text-ink-2">{lot?.title ?? ""}</p>

      <div className={`mt-5 rounded-stage border p-6 ${leading || won ? "border-paddle bg-paddle-soft" : "border-line bg-surface"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink-2">Your paddle</p>
            <p className="font-narrow tabular text-6xl font-extrabold leading-none">{alias}</p>
            <p className={`mt-3 text-lg font-semibold ${status.tone}`} role="status" aria-live="polite">
              {status.text}
            </p>
          </div>
          <TagIllustration
            alias={alias}
            switchOn={me?.status === "ACTIVE"}
            led={leading || won ? "lead" : me?.status === "ACTIVE" ? "steady" : "off"}
            className="w-24 shrink-0"
          />
        </div>

        {state ? (
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-sm font-semibold text-ink-2">{state.phase === "SOLD_LOCKED" ? "Hammer price" : state.bidCount ? "Current bid" : "Opening bid"}</p>
            <PriceDisplay priceMinor={state.priceMinor} unit={state.rules.unit} bidSeq={lastBidSeq} size="phone" sold={state.phase === "SOLD_LOCKED"} />
            {state.phase === "COUNTDOWN" && !leading ? (
              <p className="mt-2 text-ink-2">
                Press BID to go to <span className="tabular font-semibold text-ink">{formatMinor(state.nextPriceMinor)}</span>
              </p>
            ) : null}
            <div className="mt-5">
              <HammerBar state={state} msLeft={msLeft} size="md" />
            </div>
          </div>
        ) : null}
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-bold">How to bid</h2>
        <ol className="mt-4 flex flex-col gap-4">
          {[
            ["Slide the switch on", "The light pulses, then glows steady when the room has you."],
            ["Press BID", "You bid the next price on the screen. Each press adds a step."],
            ["Hold the lead", "Every new bid restarts the call. If nobody outbids you before it ends, the lot is yours."],
          ].map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
              <span className="font-narrow tabular text-3xl font-extrabold leading-none text-ink-3">{i + 1}</span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="text-ink-2">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ink-3">
          Switching off stops you bidding but doesn&apos;t cancel a bid that&apos;s leading.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold">What the light means</h2>
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {LIGHTS.map((l) => (
            <div key={l.look} className="grid grid-cols-[9rem_1fr] gap-3 py-3">
              <dt className="font-semibold">{l.look}</dt>
              <dd className="text-ink-2">{l.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Link href={`/room/${auctionId}`} className={buttonClass("outline", "lg", "mt-10 w-full")}>
        Open the big screen
      </Link>
    </div>
  );
}
