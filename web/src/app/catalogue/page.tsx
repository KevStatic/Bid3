import { Container } from "@/components/ui";
import { CatalogueView } from "./catalogue-view";

export const metadata = { title: "Lots" };

export default function CataloguePage() {
  return (
    <Container>
      <CatalogueView />
    </Container>
  );
}
