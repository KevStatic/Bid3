/** Bid3 mark: an auction paddle, seen face-on. */
export function PaddleMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="13.5" y="19" width="5" height="11" rx="2" fill="var(--ink)" />
      <circle cx="16" cy="13" r="11.5" fill="var(--paddle)" stroke="var(--ink)" strokeWidth="2" />
      <text
        x="16"
        y="17.6"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="var(--paddle-ink)"
        style={{ fontFamily: "var(--font-sans)", fontStretch: "80%" }}
      >
        3
      </text>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <PaddleMark />
      <span className="font-wide text-[1.35rem] font-extrabold tracking-[-0.03em]">Bid3</span>
    </span>
  );
}
