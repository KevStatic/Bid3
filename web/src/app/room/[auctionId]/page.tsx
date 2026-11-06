import { Suspense } from "react";
import { Container, Skeleton } from "@/components/ui";
import { RoomView } from "./room-view";

export const metadata = { title: "Live room" };

export default function RoomPage({ params }: PageProps<"/room/[auctionId]">) {
  return (
    <Suspense fallback={<RoomSkeleton />}>
      <Room params={params} />
    </Suspense>
  );
}

async function Room({ params }: { params: PageProps<"/room/[auctionId]">["params"] }) {
  const { auctionId } = await params;
  return <RoomView auctionId={decodeURIComponent(auctionId)} />;
}

function RoomSkeleton() {
  return (
    <Container className="py-8">
      <Skeleton className="h-[30rem] w-full rounded-stage" />
    </Container>
  );
}
