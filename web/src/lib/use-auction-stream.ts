"use client";

import { useEffect, useRef, useState } from "react";
import { config } from "./config";
import { AuctionSimulator } from "./simulator";
import type { AuctionState, BidEvent, StreamMessage } from "./types";

export type StreamSource = "engine" | "simulation";
export type Connection = "connecting" | "open" | "reconnecting";

export interface AuctionStream {
  state: AuctionState | null;
  bids: BidEvent[];
  source: StreamSource;
  connection: Connection;
  /** Engine clock minus browser clock, so countdowns use the engine's deadline. */
  clockOffsetMs: number;
  /** Only present in simulation. */
  simulator: AuctionSimulator | null;
  /** Bumps on every accepted bid, so components can animate exactly once per bid. */
  lastBidSeq: number | null;
}

const MAX_BIDS_KEPT = 200;

export function useAuctionStream(auctionId: string, options: { autoplay?: boolean } = {}): AuctionStream {
  const source: StreamSource = config.engineWsUrl ? "engine" : "simulation";
  const [state, setState] = useState<AuctionState | null>(null);
  const [bids, setBids] = useState<BidEvent[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [lastBidSeq, setLastBidSeq] = useState<number | null>(null);
  const [simulator, setSimulator] = useState<AuctionSimulator | null>(null);
  const autoplay = options.autoplay ?? true;
  const autoplayRef = useRef(autoplay);

  useEffect(() => {
    const handle = (message: StreamMessage) => {
      setClockOffsetMs(message.state.serverTimeMs - Date.now());
      setState(message.state);
      if (message.type === "snapshot") {
        setBids(message.bids.slice(0, MAX_BIDS_KEPT));
        setLastBidSeq(null);
      } else if (message.type === "bid") {
        setBids((prev) => (prev.some((b) => b.serverSeq === message.bid.serverSeq) ? prev : [message.bid, ...prev].slice(0, MAX_BIDS_KEPT)));
        setLastBidSeq(message.bid.serverSeq);
      }
    };

    if (source === "simulation") {
      const sim = new AuctionSimulator({ auctionId, autoplay: autoplayRef.current });
      const unsubscribe = sim.subscribe(handle);
      sim.start();
      setSimulator(sim);
      setConnection("open");
      return () => {
        unsubscribe();
        sim.stop();
        setSimulator(null);
      };
    }

    // Engine: read-only public stream with exponential reconnect.
    let socket: WebSocket | null = null;
    let attempt = 0;
    let closedByUs = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setConnection(attempt === 0 ? "connecting" : "reconnecting");
      socket = new WebSocket(`${config.engineWsUrl}/auctions/${encodeURIComponent(auctionId)}/stream`);
      socket.onopen = () => {
        attempt = 0;
        setConnection("open");
      };
      socket.onmessage = (event) => {
        try {
          handle(JSON.parse(event.data as string) as StreamMessage);
        } catch {
          // Ignore malformed frames; the next snapshot corrects state.
        }
      };
      socket.onclose = () => {
        if (closedByUs) return;
        attempt += 1;
        setConnection("reconnecting");
        retryTimer = setTimeout(connect, Math.min(8_000, 400 * 2 ** attempt));
      };
    };
    connect();

    return () => {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [auctionId, source]);

  return { state, bids, source, connection, clockOffsetMs, simulator, lastBidSeq };
}

/** Milliseconds left on the hammer countdown, updated every animation frame. */
export function useCountdown(state: AuctionState | null, clockOffsetMs: number): number | null {
  const deadline = state?.countdown?.deadlineMs ?? null;
  // Tagged with its deadline so a reading from a previous countdown is never shown.
  const [tick, setTick] = useState<{ deadline: number; left: number } | null>(null);

  useEffect(() => {
    if (deadline === null) return;
    let frame = 0;
    const loop = () => {
      const left = Math.max(0, deadline - (Date.now() + clockOffsetMs));
      setTick({ deadline, left });
      if (left > 0) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [deadline, clockOffsetMs]);

  if (deadline === null) return null;
  return tick && tick.deadline === deadline ? tick.left : state?.countdown?.durationMs ?? null;
}
