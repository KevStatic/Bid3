import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "paddle" | "outline" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-wall hover:bg-ink/88",
  paddle: "bg-paddle text-paddle-ink hover:brightness-[1.04] shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]",
  outline: "border border-line-strong bg-surface text-ink hover:border-ink-2",
  quiet: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-halt text-white hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 rounded-md px-3 text-sm",
  md: "h-10 rounded-lg px-4 text-[0.9375rem]",
  lg: "h-12 rounded-xl px-5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** Where a number on screen came from. Every data surface shows one. */
export type Provenance = "engine" | "simulation" | "arkiv" | "sample";

const provenance: Record<Provenance, { label: string; dot: string; title: string }> = {
  engine: { label: "Live", dot: "bg-live", title: "Streaming from the Bid3 engine" },
  simulation: { label: "Simulation", dot: "bg-paddle", title: "In-browser simulation. No hardware or engine is connected." },
  arkiv: { label: "From Arkiv", dot: "bg-cobalt", title: "Read directly from the Arkiv testnet in your browser" },
  sample: { label: "Sample data", dot: "bg-ink-3", title: "Bundled sample entities shaped like Arkiv reads" },
};

export function SourceBadge({ source, className = "" }: { source: Provenance; className?: string }) {
  const p = provenance[source];
  return (
    <span
      title={p.title}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-2 ${className}`}
    >
      <span className={`size-1.5 rounded-full ${p.dot} ${source === "engine" ? "animate-pulse-dot" : ""}`} aria-hidden />
      {p.label}
    </span>
  );
}

/** The yellow lot tag, as pinned to an item at an auction preview. */
export function LotTag({ lot, size = "md" }: { lot: number; size?: "sm" | "md" | "lg" }) {
  const sizing = { sm: "h-6 px-2 text-xs", md: "h-7 px-2.5 text-sm", lg: "h-9 px-3 text-base" }[size];
  return (
    <span
      className={`tabular inline-flex shrink-0 items-center whitespace-nowrap rounded-tag bg-paddle font-bold text-paddle-ink ${sizing}`}
      style={{ fontStretch: "90%" }}
    >
      Lot {String(lot).padStart(2, "0")}
    </span>
  );
}

type Tone = "neutral" | "live" | "halt" | "paddle" | "cobalt";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  live: "bg-live-soft text-live border-transparent",
  halt: "bg-halt-soft text-halt border-transparent",
  paddle: "bg-paddle-soft text-ink border-transparent",
  cobalt: "bg-cobalt-soft text-cobalt border-transparent",
};

export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Panel({ className = "", children, ...props }: ComponentProps<"section">) {
  return (
    <section className={`rounded-panel border border-line bg-surface ${className}`} {...props}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  lede,
  aside,
}: {
  title: string;
  lede?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pb-8 pt-10 sm:flex-row sm:items-end sm:justify-between sm:pt-14">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold sm:text-[2.6rem]">{title}</h1>
        {lede ? <p className="mt-3 text-lg text-ink-2">{lede}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function Container({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-[76rem] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden />;
}

export function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" className="size-4 text-live" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="size-4 text-halt" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
