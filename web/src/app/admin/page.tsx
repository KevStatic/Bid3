import { Container } from "@/components/ui";
import { AdminView } from "./admin-view";

export const metadata = { title: "Auctioneer", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Container>
      <AdminView />
    </Container>
  );
}
