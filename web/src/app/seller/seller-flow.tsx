"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { TagIllustration } from "@/components/tag-illustration";
import { Button, buttonClass, CheckMark, LotTag, PageHeader, Panel, SourceBadge } from "@/components/ui";
import { WalletButton } from "@/components/wallet-button";
import { publishListing, type PublishOutcome } from "@/lib/arkiv/write-listing";
import { config, explorerEntityUrl, isSampleArkiv, isSimulation } from "@/lib/config";
import { formatMinor, percentFromBps, shortKey } from "@/lib/format";
import { bidLadder, bidsToCeiling } from "@/lib/pricing";
import { useEngineHealth, useFeaturedAuctionId } from "@/lib/use-featured-auction";

const STEPS = ["Item", "Rules", "Paddles", "Readiness", "Open the round"] as const;
type Step = (typeof STEPS)[number];

const CATEGORIES = ["Electronics", "Watches", "Cameras", "Textiles", "Craft", "Music", "Collectibles", "Other"];
const STEP_OPTIONS = [200, 500, 700, 1000];
const COUNTDOWN_OPTIONS = [5_000, 8_000, 10_000];

const ALIAS_LETTERS = "ABCDEFGHJKLMNPQRTVWXY";
const randomAlias = (taken: string[]) => {
  for (;;) {
    const a = `${ALIAS_LETTERS[Math.floor(Math.random() * ALIAS_LETTERS.length)]}${1 + Math.floor(Math.random() * 9)}`;
    if (!taken.includes(a)) return a;
  }
};

const toMinor = (text: string) => {
  const v = Number.parseFloat(text);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};

/** A fresh, unguessable suffix per listing, so nobody can write a look-alike listing for it first. */
function newLotSuffix() {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join("");
  return `${Date.now().toString(36)}${random}`;
}

export function SellerFlow() {
  const featuredId = useFeaturedAuctionId();
  const { data: engineHealth } = useEngineHealth();
  const { address, isConnected } = useAccount();
  const [step, setStepState] = useState<Step>("Item");
  const [visited, setVisited] = useState<Set<Step>>(() => new Set<Step>(["Item"]));
  const setStep = (next: Step) => {
    setStepState(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };
  const ids = { title: useId(), category: useId(), condition: useId(), description: useId(), start: useId(), ceiling: useId() };

  const [item, setItem] = useState({ title: "", category: "Electronics", condition: "", description: "" });
  const [startText, setStartText] = useState("100.00");
  const [stepBps, setStepBps] = useState(500);
  const [countdownMs, setCountdownMs] = useState(5_000);
  const [ceilingText, setCeilingText] = useState("1000.00");
  const [aliases, setAliases] = useState<[string, string]>(["K7", "M4"]);
  const [published, setPublished] = useState<PublishOutcome | null>(null);
  /** This listing's own auction and listing IDs: never the live lot's, so a test listing can't take over its title. */
  const [lot, setLot] = useState<{ auctionId: string; listingId: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const startMinor = toMinor(startText);
  const ceilingMinor = toMinor(ceilingText);
  const rulesValid = startMinor !== null && ceilingMinor !== null && ceilingMinor > startMinor;
  const itemValid = item.title.trim().length >= 3 && item.condition.trim().length > 0;

  const ladder = useMemo(
    () => (rulesValid ? bidLadder({ startPriceMinor: startMinor!, stepBps, ceilingMinor: ceilingMinor! }, 8) : []),
    [rulesValid, startMinor, stepBps, ceilingMinor],
  );
  const toCeiling = rulesValid ? bidsToCeiling({ startPriceMinor: startMinor!, stepBps, ceilingMinor: ceilingMinor! }) : null;

  const done: Record<Step, boolean> = {
    Item: itemValid && !!published,
    Rules: rulesValid && visited.has("Rules") && step !== "Rules",
    Paddles: aliases[0] !== aliases[1] && visited.has("Paddles") && step !== "Paddles",
    Readiness: false,
    "Open the round": false,
  };

  const readiness: { label: string; ok: boolean; note?: string; detail?: string }[] = [
    { label: "Wallet connected", ok: isConnected },
    { label: "Listing published to Arkiv", ok: !!published },
    { label: "Rules are valid", ok: rulesValid },
    { label: "Two paddles assigned", ok: aliases[0] !== aliases[1] },
    isSimulation
      ? { label: "Bridge connected to the engine", ok: false, note: "No engine connected. You can still open the round in simulation." }
      : {
          label: "Bridge connected to the engine",
          ok: !!engineHealth?.bridgeConnected,
          detail: engineHealth
            ? engineHealth.bridgeConnected
              ? undefined
              : "Start the bridge on the laptop the gateway is plugged into."
            : "Can't reach the engine.",
        },
  ];
  const ready = readiness.every((r) => r.ok || r.note);

  // Opening needs ADMIN_TOKEN, which must never reach the browser, so the operator runs these.
  const engineUrl = config.engineHttpUrl ?? "http://localhost:8010";
  const openCommands =
    lot && rulesValid
      ? [
          `curl -X POST ${engineUrl}/auctions -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '${JSON.stringify({
            auctionId: lot.auctionId,
            listingId: lot.listingId,
            category: item.category,
            rules: { startPriceMinor: startMinor, stepBps, countdownMs, ceilingMinor, timeLimitMs: 600_000 },
            seats: [
              { tagRef: "TAG1", alias: aliases[0] },
              { tagRef: "TAG2", alias: aliases[1] },
            ],
          })}'`,
          `curl -X POST ${engineUrl}/auctions/${lot.auctionId}/open -H "Authorization: Bearer $ADMIN_TOKEN"`,
        ].join("\n")
      : null;
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!openCommands) return;
    try {
      await navigator.clipboard.writeText(openCommands);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard blocked: the commands are still on screen to select by hand.
    }
  };

  const index = STEPS.indexOf(step);
  const go = (delta: number) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, index + delta))]);

  const onPublish = async () => {
    if (!address) return;
    setPublishing(true);
    setPublishError(null);
    const suffix = newLotSuffix();
    const lotIds = { auctionId: `bid3-${suffix}`, listingId: `lot-${suffix}` };
    try {
      const outcome = await publishListing(
        {
          listingId: lotIds.listingId,
          lotNumber: 9,
          auctionId: lotIds.auctionId,
          title: item.title.trim(),
          category: item.category,
          condition: item.condition.trim(),
          description: item.description.trim(),
          sellerAlias: `Seller ${address.slice(2, 6)}`,
          startPriceMinor: startMinor ?? 10_000,
          closesAtMs: Date.now() + 60 * 60 * 1000,
        },
        address,
      );
      setPublished(outcome);
      setLot(lotIds);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "The wallet didn't sign the listing.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sell an item"
        lede="Publish the listing from your own wallet, set how bidding climbs, and assign the paddles. The rules freeze the moment the round opens."
        aside={<SourceBadge source={isSampleArkiv ? "sample" : "arkiv"} />}
      />

      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Listing steps" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1">
            {STEPS.map((s, i) => (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  aria-current={s === step ? "step" : undefined}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink-2 hover:bg-surface aria-[current=step]:bg-surface aria-[current=step]:text-ink aria-[current=step]:shadow-[inset_3px_0_0_var(--paddle)]"
                >
                  <span
                    className={`tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      done[s] ? "bg-live text-white" : s === step ? "bg-ink text-wall" : "bg-surface-2 text-ink-3"
                    }`}
                  >
                    {done[s] ? "✓" : i + 1}
                  </span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <Panel className="p-5 sm:p-8">
          {step === "Item" ? (
            <StepBody title="What are you selling?" lede="This becomes an ItemListing entity owned by your wallet. You can edit it until the round opens.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Title" htmlFor={ids.title} className="sm:col-span-2">
                  <input
                    id={ids.title}
                    value={item.title}
                    onChange={(e) => setItem({ ...item, title: e.target.value })}
                    placeholder="Hand-wired split keyboard, 42 keys"
                    className={inputClass}
                  />
                </Field>
                <Field label="Category" htmlFor={ids.category}>
                  <select id={ids.category} value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })} className={inputClass}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Condition" htmlFor={ids.condition}>
                  <input
                    id={ids.condition}
                    value={item.condition}
                    onChange={(e) => setItem({ ...item, condition: e.target.value })}
                    placeholder="Works, small scratch on the case"
                    className={inputClass}
                  />
                </Field>
                <Field label="Description" htmlFor={ids.description} className="sm:col-span-2" hint="Optional. Plain text, shown on the lot page.">
                  <textarea
                    id={ids.description}
                    rows={4}
                    value={item.description}
                    onChange={(e) => setItem({ ...item, description: e.target.value })}
                    className={`${inputClass} h-auto py-2.5`}
                  />
                </Field>
              </div>

              <div className="mt-8 rounded-panel border border-line bg-surface-2 p-5">
                {published ? (
                  <div className="flex flex-col gap-1">
                    <p className="flex items-center gap-2 font-semibold">
                      <CheckMark ok /> {published.simulated ? "Listing prepared (sample mode, nothing sent)" : "Listing published to Arkiv"}
                    </p>
                    <p className="text-sm text-ink-2">
                      Entity{" "}
                      {published.simulated ? (
                        <span className="tabular">{shortKey(published.entityKey)}</span>
                      ) : (
                        <a className="tabular text-cobalt hover:underline" href={explorerEntityUrl(published.entityKey)} target="_blank" rel="noreferrer">
                          {shortKey(published.entityKey)}
                        </a>
                      )}
                      , owned by your wallet. It expires a day after the auction closes.
                    </p>
                  </div>
                ) : isConnected ? (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="max-w-md text-sm text-ink-2">Your wallet signs the write, so the listing is yours on Arkiv, not ours.</p>
                    <Button onClick={onPublish} disabled={!itemValid || publishing}>
                      {publishing ? "Waiting for signature…" : "Publish listing"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="max-w-md text-sm text-ink-2">Connect the wallet that should own this listing.</p>
                    <WalletButton size="md" />
                  </div>
                )}
                {publishError ? (
                  <p role="alert" className="mt-3 text-sm text-halt">
                    {publishError}
                  </p>
                ) : null}
              </div>
            </StepBody>
          ) : null}

          {step === "Rules" ? (
            <StepBody title="How does bidding climb?" lede="Each accepted press bids the next rung of this ladder. These numbers freeze when the round opens and their hash goes on Arkiv.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Opening bid" htmlFor={ids.start} hint="In demo credits.">
                  <input id={ids.start} inputMode="decimal" value={startText} onChange={(e) => setStartText(e.target.value)} className={`${inputClass} tabular`} />
                </Field>
                <Field label="Ceiling" htmlFor={ids.ceiling} hint="Bids stop here; the leader then wins at the ceiling.">
                  <input id={ids.ceiling} inputMode="decimal" value={ceilingText} onChange={(e) => setCeilingText(e.target.value)} className={`${inputClass} tabular`} />
                </Field>
                <Choice label="Each bid adds" options={STEP_OPTIONS} value={stepBps} onChange={setStepBps} format={percentFromBps} />
                <Choice label="Hammer falls after" options={COUNTDOWN_OPTIONS} value={countdownMs} onChange={setCountdownMs} format={(ms) => `${ms / 1000} s`} />
              </div>

              <div className="mt-8">
                <h3 className="text-base font-bold">Bid ladder</h3>
                {rulesValid ? (
                  <>
                    <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ladder.map((price, i) => (
                        <li key={i} className="rounded-lg border border-line px-3 py-2">
                          <span className="block text-xs text-ink-3">{i === 0 ? "Opening bid" : `Bid ${i + 1}`}</span>
                          <span className="font-narrow tabular text-2xl font-bold">{formatMinor(price)}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-sm text-ink-2">
                      Reaches the ceiling of {formatMinor(ceilingMinor!)} on bid {toCeiling}. Every bid restarts a {countdownMs / 1000} s call.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-halt">Set an opening bid above zero and a ceiling higher than it.</p>
                )}
              </div>
            </StepBody>
          ) : null}

          {step === "Paddles" ? (
            <StepBody
              title="Assign the paddles"
              lede="Each physical tag gets a fresh alias for this round only. Bidders appear on screen and on Arkiv as their alias, never as a device ID."
            >
              <ul className="grid gap-4 sm:grid-cols-2">
                {aliases.map((alias, i) => (
                  <li key={i} className="flex items-center gap-4 rounded-panel border border-line p-4">
                    <TagIllustration alias={alias} className="w-20 shrink-0" />
                    <div>
                      <p className="text-sm text-ink-3">Tag {i + 1}</p>
                      <p className="font-narrow tabular text-4xl font-extrabold leading-none">{alias}</p>
                      <button
                        type="button"
                        className="mt-2 text-sm font-semibold text-cobalt hover:underline"
                        onClick={() => {
                          const next = [...aliases] as [string, string];
                          next[i] = randomAlias(aliases);
                          setAliases(next);
                        }}
                      >
                        New alias
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-ink-2">
                Hand each bidder their tag and point them to its NFC sticker. It opens a page that explains the switch and the BID button.
              </p>
            </StepBody>
          ) : null}

          {step === "Readiness" ? (
            <StepBody title="Ready to open?" lede="The round can't open while anything that decides the winner is missing.">
              <ul className="divide-y divide-line rounded-panel border border-line">
                {readiness.map((r) => (
                  <li key={r.label} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5">{r.ok ? <CheckMark ok /> : r.note ? <span className="block size-4 rounded-full border-2 border-paddle" aria-hidden /> : <CheckMark ok={false} />}</span>
                    <span>
                      <span className="font-semibold">{r.label}</span>
                      {r.note ? <span className="block text-sm text-ink-2">{r.note}</span> : null}
                      {!r.ok && r.detail ? <span className="block text-sm text-ink-2">{r.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </StepBody>
          ) : null}

          {step === "Open the round" ? (
            <StepBody title="Open the round" lede="Opening freezes the rules and publishes their hash. After this, nothing about the auction can change.">
              {startMinor !== null ? (
                <div className="flex flex-wrap items-center gap-4 rounded-panel border border-line bg-surface-2 p-5">
                  <LotTag lot={9} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-bold">{item.title || "Untitled lot"}</p>
                    <p className="text-sm text-ink-2">
                      Opens at {formatMinor(startMinor)}, +{percentFromBps(stepBps)} a bid, hammer after {countdownMs / 1000} s. Paddles {aliases[0]} and{" "}
                      {aliases[1]}.
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {isSimulation ? (
                  <>
                    {ready ? (
                      <Link href={`/room/${featuredId}`} className={buttonClass("paddle", "lg")}>
                        Open in simulation
                      </Link>
                    ) : (
                      <Button variant="paddle" size="lg" disabled>
                        Open in simulation
                      </Button>
                    )}
                    <p className="text-sm text-ink-2">No engine is connected, so the room runs the labelled simulation.</p>
                  </>
                ) : ready && openCommands && lot ? (
                  <div className="w-full min-w-0">
                    <p className="max-w-2xl text-sm text-ink-2">
                      Opening needs the operator&apos;s admin token, which never ships to the browser. The operator runs these two commands; this
                      lot&apos;s room is then live and becomes the one the paddles bid in. Paddles switch off and on to join it.
                    </p>
                    <pre className="tabular mt-4 overflow-x-auto whitespace-pre rounded-lg border border-line bg-surface-2 p-4 text-xs leading-relaxed">
                      {openCommands}
                    </pre>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button variant="primary" onClick={onCopy}>
                        {copied ? "Copied" : "Copy commands"}
                      </Button>
                      <Link href={`/room/${lot.auctionId}`} className={buttonClass("paddle", "lg")}>
                        Go to this lot&apos;s room
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
              {!ready ? <p className="mt-3 text-sm text-halt">Finish the readiness checks first.</p> : null}
            </StepBody>
          ) : null}

          <div className="mt-10 flex items-center justify-between border-t border-line pt-5">
            <Button variant="quiet" onClick={() => go(-1)} disabled={index === 0}>
              Back
            </Button>
            {index < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => go(1)}>
                Continue to {STEPS[index + 1].toLowerCase()}
              </Button>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-line bg-surface-2 px-3 text-ink placeholder:text-ink-3 focus:border-cobalt focus:bg-surface focus:outline-none";

function StepBody({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-2 max-w-2xl text-ink-2">{lede}</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function Field({ label, htmlFor, hint, className = "", children }: { label: string; htmlFor: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-sm text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className="tabular h-11 min-w-16 rounded-lg border border-line bg-surface-2 px-3 font-semibold text-ink-2 hover:border-line-strong aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-wall"
          >
            {format(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
