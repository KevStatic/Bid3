import { Suspense } from "react";
import { Container, Skeleton } from "@/components/ui";
import { SeatView } from "./seat-view";

export const metadata = { title: "Your paddle" };

export default function SeatPage({ params }: PageProps<"/seat/[alias]">) {
  return (
    <Container className="max-w-xl">
      <Suspense fallback={<Skeleton className="mt-8 h-[28rem] w-full rounded-stage" />}>
        <Seat params={params} />
      </Suspense>
    </Container>
  );
}

async function Seat({ params }: { params: PageProps<"/seat/[alias]">["params"] }) {
  const { alias } = await params;
  return <SeatView alias={decodeURIComponent(alias).toUpperCase()} />;
}
