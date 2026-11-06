import { ButtonLink, Container } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="py-24">
      <p className="font-narrow tabular text-7xl font-extrabold text-ink-3">404</p>
      <h1 className="mt-4 text-3xl font-bold">No lot at this address</h1>
      <p className="mt-3 max-w-md text-ink-2">The link may be from an old round. Live and past lots are all in the catalogue.</p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/catalogue">Browse lots</ButtonLink>
        <ButtonLink href="/" variant="outline">
          Go home
        </ButtonLink>
      </div>
    </Container>
  );
}
