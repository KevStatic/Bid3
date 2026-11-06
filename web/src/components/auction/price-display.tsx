"use client";

import { formatMinor } from "@/lib/format";

/**
 * The hero number. Condensed Archivo, tabular figures.
 * Re-keyed on every accepted bid so it lands with one short motion.
 */
export function PriceDisplay({
  priceMinor,
  unit,
  bidSeq,
  size = "stage",
  sold = false,
}: {
  priceMinor: number;
  unit: string;
  bidSeq: number | null;
  size?: "stage" | "card" | "phone";
  sold?: boolean;
}) {
  const sizing = {
    stage: "text-[clamp(4.75rem,12vw,11.5rem)]",
    card: "text-[clamp(3.5rem,8vw,6.25rem)]",
    phone: "text-[clamp(3.5rem,19vw,5.5rem)]",
  }[size];

  return (
    <div className="flex items-end gap-3">
      <span
        key={bidSeq ?? "initial"}
        className={`font-narrow tabular block font-extrabold leading-[0.86] tracking-[-0.02em] ${sizing} ${bidSeq !== null ? "animate-bid-land" : ""} ${
          sold ? "text-ink [text-decoration:underline_0.08em_var(--paddle)] [text-underline-offset:0.1em]" : ""
        }`}
      >
        {formatMinor(priceMinor)}
      </span>
      <span className="pb-[0.5em] text-sm font-medium text-ink-3 sm:text-base">{unit}</span>
    </div>
  );
}
