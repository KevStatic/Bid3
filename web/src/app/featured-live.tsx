"use client";

import { ButtonLink } from "@/components/ui";
import { useFeaturedAuctionId } from "@/lib/use-featured-auction";
import { LiveLotCard } from "./live-lot-card";

export function FeaturedRoomButton() {
  return (
    <ButtonLink href="/room" size="lg">
      Watch the live room
    </ButtonLink>
  );
}

export function FeaturedLotCard() {
  return <LiveLotCard auctionId={useFeaturedAuctionId()} />;
}
