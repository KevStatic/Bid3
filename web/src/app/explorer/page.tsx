import { Container } from "@/components/ui";
import { ExplorerView } from "./explorer-view";

export const metadata = { title: "Results" };

export default function ExplorerPage() {
  return (
    <Container>
      <ExplorerView />
    </Container>
  );
}
