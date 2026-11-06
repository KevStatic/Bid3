import { Container } from "@/components/ui";
import { SellerFlow } from "./seller-flow";

export const metadata = { title: "Sell an item" };

export default function SellerPage() {
  return (
    <Container>
      <SellerFlow />
    </Container>
  );
}
