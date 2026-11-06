"use client";

import { useNow } from "@/lib/use-now";
import type { AuctionState, Health } from "@/lib/types";

const TONE: Record<Health, { dot: string; label: string }> = {
  ok: { dot: "bg-live", label: "OK" },
  degraded: { dot: "bg-paddle", label: "Slow" },
  down: { dot: "bg-halt", label: "Down" },
};

export function HealthStrip({ state, clockOffsetMs }: { state: AuctionState; clockOffsetMs: number }) {
  const clock = useNow();
  const now = clock === null ? null : clock + clockOffsetMs;
  const items: { name: string; health: Health }[] = [
    { name: "Gateway", health: state.health.gateway },
    { name: "Bridge", health: state.health.bridge },
    { name: "Engine", health: state.health.engine },
  ];
  const published = state.arkiv.lastPublishedAtMs;
  const age = published && now !== null ? Math.max(0, Math.round((now - published) / 1000)) : null;

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.name} className="flex flex-col">
          <dt className="text-ink-3">{item.name}</dt>
          <dd className="flex items-center gap-1.5 font-semibold">
            <span className={`size-2 rounded-full ${TONE[item.health].dot}`} aria-hidden />
            {TONE[item.health].label}
          </dd>
        </div>
      ))}
      <div className="flex flex-col">
        <dt className="text-ink-3">Last Arkiv snapshot</dt>
        <dd className="tabular font-semibold">
          {age === null ? "Not yet published" : age < 2 ? "Just now" : `${age} s ago`}
          {state.arkiv.pending > 0 ? <span className="ml-1.5 font-normal text-ink-3">({state.arkiv.pending} pending)</span> : null}
        </dd>
      </div>
    </dl>
  );
}
