"use client";

import { useState } from "react";
import { buttonClass, Container, Panel, Skeleton } from "@/components/ui";
import { useLiveLot } from "@/lib/use-live-lot";
import Link from "next/link";
import { RoomView } from "./[auctionId]/room-view";

/**
 * The Live room (/room): the lot that's open for bidding right now. With nothing open, it says so
 * instead of showing an old lot, and switches to the next lot by itself when the auctioneer opens it.
 * Once a lot is on screen it stays there through the hammer (result and payment), and RoomView moves
 * on to the next lot when one opens.
 */
export function LiveRoom() {
  const { liveId, ready, reachable } = useLiveLot();
  const [shown, setShown] = useState<string | null>(null);
  if (liveId && shown === null) setShown(liveId);

  if (shown) return <RoomView auctionId={shown} syncUrl={false} />;
  if (!ready) {
    return (
      <Container className="py-8">
        <Skeleton className="h-[30rem] w-full rounded-stage" />
      </Container>
    );
  }

  return (
    <Container className="py-8 sm:py-12">
      <Panel className="mx-auto max-w-2xl p-8 text-center sm:p-12">
        <p className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm text-ink-2">
          <span className="size-2 rounded-full bg-ink-3" aria-hidden />
          {reachable ? "Nothing live" : "Room offline"}
        </p>
        <h1 className="mt-5 text-3xl font-bold sm:text-4xl" role="status" aria-live="polite">
          {reachable ? "No bidding is going on right now" : "The auction room isn't reachable right now"}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-ink-2">
          {reachable
            ? "The next lot appears here as soon as the auctioneer opens bidding. Keep this page open; there's no need to refresh."
            : "The room runs on the event laptop. Keep this page open and it connects as soon as the room is back."}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/catalogue" className={buttonClass("primary", "lg")}>
            Browse the lots
          </Link>
          <Link href="/explorer" className={buttonClass("outline", "lg")}>
            See past results
          </Link>
        </div>
      </Panel>
    </Container>
  );
}
