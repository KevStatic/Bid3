"use client";

import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui";
import type { AuctionSimulator } from "@/lib/simulator";
import type { AuctionState } from "@/lib/types";

const REFUSAL: Record<string, string> = {
  CLOSED: "The round is closed.",
  NOT_ACTIVE: "Switch this paddle on first.",
  LEADING: "This paddle already leads.",
  NOT_OPEN: "Bidding isn't open yet.",
  CEILING: "The ceiling has been reached.",
};

/**
 * Lets the team drive the room without hardware. Keys mirror the tags:
 * 1 / 2 press BID, Q / W flip the switch.
 */
export function SimulationControls({ simulator, state }: { simulator: AuctionSimulator; state: AuctionState }) {
  const [autoplay, setAutoplay] = useState(simulator.isAutoplay());
  const [notice, setNotice] = useState<string | null>(null);
  const [a, b] = state.paddles;

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2_400);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      const bid = (alias?: string) => {
        if (!alias) return;
        const refused = simulator.bid(alias);
        setNotice(refused ? `Paddle ${alias}: ${REFUSAL[refused]}` : null);
      };
      if (key === "1") bid(a?.alias);
      if (key === "2") bid(b?.alias);
      if (key === "q" && a) simulator.toggle(a.alias);
      if (key === "w" && b) simulator.toggle(b.alias);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [simulator, a, b]);

  const takeOver = () => {
    simulator.setAutoplay(false);
    setAutoplay(false);
  };

  return (
    <Panel className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Simulation controls</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const next = !autoplay;
              simulator.setAutoplay(next);
              setAutoplay(next);
            }}
          >
            {autoplay ? "Take over" : "Resume script"}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => simulator.restartRound()}>
            Restart round
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        {autoplay ? "A scripted round is playing. Take over to drive the paddles yourself." : "You are driving the paddles. Nothing here reaches real hardware."}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {[a, b].map((paddle, i) =>
          paddle ? (
            <div key={paddle.alias} className="rounded-lg border border-line p-3">
              <p className="font-semibold">Paddle {paddle.alias}</p>
              <div className="mt-2 flex flex-col gap-2">
                <Button
                  size="sm"
                  variant="paddle"
                  onClick={() => {
                    if (autoplay) takeOver();
                    const refused = simulator.bid(paddle.alias);
                    setNotice(refused ? `Paddle ${paddle.alias}: ${REFUSAL[refused]}` : null);
                  }}
                >
                  Press BID <kbd className="rounded bg-black/10 px-1 text-xs">{i === 0 ? "1" : "2"}</kbd>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (autoplay) takeOver();
                    simulator.toggle(paddle.alias);
                  }}
                >
                  {paddle.status === "ACTIVE" ? "Switch off" : "Switch on"} <kbd className="rounded bg-surface-2 px-1 text-xs">{i === 0 ? "Q" : "W"}</kbd>
                </Button>
              </div>
            </div>
          ) : null,
        )}
      </div>
      <p className="mt-3 min-h-5 text-sm text-halt" role="status" aria-live="polite">
        {notice}
      </p>
    </Panel>
  );
}
