import { Suspense } from "react";
import { Container, Skeleton } from "@/components/ui";
import { BidsView } from "./bids-view";

export const metadata = { title: "Bid history" };

export default function BidsPage({ params }: PageProps<"/auction/[id]/bids">) {
  return (
    <Container>
      <Suspense fallback={<Skeleton className="mt-14 h-96 w-full rounded-panel" />}>
        <Bids params={params} />
      </Suspense>
    </Container>
  );
}

async function Bids({ params }: { params: PageProps<"/auction/[id]/bids">["params"] }) {
  const { id } = await params;
  return <BidsView auctionId={decodeURIComponent(id)} />;
}
