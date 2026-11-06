"use client";

import type { AuctionState } from "@/lib/types";

const SEGMENTS = ["Going once", "Going twice", "Sold"] as const;

/**
 * The hammer countdown, told the way an auctioneer calls it.
 * The bar drains over the countdown; each third lights its call.
 * The engine owns the deadline; this only renders it.
 */
export function HammerBar({
  state,
  msLeft,
  size = "lg",
}: {
  state: AuctionState;
  msLeft: number | null;
  size?: "md" | "lg";
}) {
  const sold = state.phase === "SOLD_LOCKED";
  const paused = state.phase === "PAUSED";
  const running = state.phase === "COUNTDOWN" && state.countdown && msLeft !== null;
  const duration = state.countdown?.durationMs ?? state.rules.countdownMs;
  const elapsed = sold ? 1 : running ? Math.min(1, 1 - (msLeft as number) / duration) : 0;
  const secondsLeft = running ? Math.ceil((msLeft as number) / 1000) : null;

  const height = size === "lg" ? "h-3" : "h-2";
  const label = size === "lg" ? "text-sm sm:text-base" : "text-xs sm:text-sm";

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 gap-1.5">
        {SEGMENTS.map((call, i) => {
          const start = i / 3;
          const fill = Math.max(0, Math.min(1, (elapsed - start) * 3));
          const lit = sold || (running && elapsed >= start);
          return (
            <div key={call} className="min-w-0">
              <div className={`${height} overflow-hidden rounded-full ${paused ? "bg-halt-soft" : "bg-surface-2"} ring-1 ring-inset ring-line`}>
                <div
                  className={`h-full rounded-full ${sold ? "bg-paddle" : paused ? "bg-halt" : "bg-ink"}`}
                  style={{ width: `${(sold ? 1 : fill) * 100}%` }}
                />
              </div>
              <p className={`mt-2 truncate font-semibold ${label} ${lit ? "text-ink" : "text-ink-3"}`}>{call}</p>
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {sold ? "Sold" : secondsLeft !== null && secondsLeft <= 3 ? `${secondsLeft} seconds until the hammer falls` : ""}
      </p>
    </div>
  );
}
