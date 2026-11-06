import { TagIllustration } from "@/components/tag-illustration";
import { ButtonLink, Container } from "@/components/ui";
import { config } from "@/lib/config";
import { LiveLotCard } from "./live-lot-card";
import { RecentResults } from "./recent-results";

const STEPS = [
  {
    title: "Switch your paddle on",
    body: "Slide the switch to join the room. The light glows steady once the room has you. Two paddles on and bidding opens.",
    tag: { switchOn: true, pressed: false, led: "steady" as const, alias: "K7" },
  },
  {
    title: "Press BID to raise",
    body: "Each press bids the next price, 5% above the last. You can't outbid yourself, and a stale press is refused so you never bid a price you didn't see.",
    tag: { switchOn: true, pressed: true, led: "lead" as const, alias: "K7" },
  },
  {
    title: "Hold the lead to the hammer",
    body: "Every bid restarts the call: going once, going twice, sold. If nobody presses before it ends, the leading paddle wins at that price.",
    tag: { switchOn: true, pressed: false, led: "lead" as const, alias: "K7" },
  },
];

const ON_ARKIV = [
  ["The listing", "written by the seller's own wallet, so we can't quietly change it"],
  ["The rules", "frozen before the round opens, with a hash anyone can recompute"],
  ["Every bid", "one entity per accepted press, in order"],
  ["The result", "hammer price, winning paddle and the issuer's wallet"],
];

export default function Home() {
  return (
    <>
      <Container className="pt-10 sm:pt-16">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-[4.1rem]">
              <span className="block">Hold a paddle.</span>
              <span className="block">Press to bid.</span>
              <span className="block">Last bid standing wins.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-2 sm:text-xl">
              Bid3 runs a live auction from physical tags. Every listing, bid and hammer price is written to Arkiv, so anyone can
              check the result without asking us.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={`/room/${config.featuredAuctionId}`} size="lg">
                Watch the live room
              </ButtonLink>
              <ButtonLink href="/catalogue" variant="outline" size="lg">
                Browse lots
              </ButtonLink>
            </div>
          </div>
          <LiveLotCard auctionId={config.featuredAuctionId} />
        </div>
      </Container>

      <Container className="mt-24 scroll-mt-24 sm:mt-32">
        <h2 id="how-it-works" className="max-w-2xl scroll-mt-24 text-3xl font-bold sm:text-4xl">
          How a round works
        </h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col rounded-panel border border-line bg-surface p-6">
              <div className="flex items-start justify-between">
                <span className="font-narrow tabular text-5xl font-extrabold leading-none text-ink-3">{i + 1}</span>
                <TagIllustration {...step.tag} className="-mr-2 -mt-2 w-24" />
              </div>
              <h3 className="mt-4 text-xl font-bold">{step.title}</h3>
              <p className="mt-2 text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-2xl text-sm text-ink-3">
          Switching off stops you bidding but doesn&apos;t withdraw a bid that&apos;s leading. If a paddle&apos;s signal drops, the room
          pauses instead of handing the lot to someone else.
        </p>
      </Container>

      <Container className="mt-24 sm:mt-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">On the public record</h2>
            <p className="mt-4 max-w-xl text-lg text-ink-2">
              The room runs fast on our engine. What it decides lands on Arkiv, where any app can read it, even when our server is
              off.
            </p>
            <dl className="mt-8 divide-y divide-line border-y border-line">
              {ON_ARKIV.map(([term, detail]) => (
                <div key={term} className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
                  <dt className="font-bold">{term}</dt>
                  <dd className="text-ink-2">{detail}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm text-ink-3">
              Kept off Arkiv: the live countdown, tag keys and anything personal. Bidders appear only as a paddle alias for one
              round.
            </p>
          </div>
          <RecentResults />
        </div>
      </Container>

      <Container className="mt-24 sm:mt-32">
        <div className="flex flex-col items-start justify-between gap-6 rounded-stage bg-banner px-6 py-10 text-banner-ink sm:flex-row sm:items-center sm:px-10">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">Have something to sell?</h2>
            <p className="mt-2 max-w-lg text-banner-ink/75">
              List it from your own wallet, set the opening bid and step, and assign paddles. The rules freeze the moment the round
              opens.
            </p>
          </div>
          <ButtonLink href="/seller" variant="paddle" size="lg">
            Start a listing
          </ButtonLink>
        </div>
      </Container>
    </>
  );
}
