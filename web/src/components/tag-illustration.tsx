/**
 * The Bid3 paddle tag: a slide switch on the edge, the BID button on the face,
 * and a dim status LED. Drawn from the real build (XIAO ESP32-C3 in a printed case).
 */
export function TagIllustration({
  switchOn = true,
  pressed = false,
  led = "steady",
  alias,
  className = "w-40",
}: {
  switchOn?: boolean;
  pressed?: boolean;
  led?: "off" | "steady" | "lead";
  alias?: string;
  className?: string;
}) {
  const ledFill = led === "off" ? "var(--line-strong)" : led === "lead" ? "var(--paddle)" : "var(--live)";
  return (
    <svg viewBox="0 0 168 200" className={className} role="img" aria-label={`Paddle tag, switch ${switchOn ? "on" : "off"}${pressed ? ", button pressed" : ""}`}>
      {/* case */}
      <rect x="18" y="14" width="116" height="172" rx="26" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="28" y="24" width="96" height="152" rx="18" fill="var(--surface-2)" />

      {/* slide switch on the right edge */}
      <rect x="132" y="52" width="14" height="40" rx="5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="135" y={switchOn ? 56 : 72} width="8" height="16" rx="3" fill="var(--ink)" />
      <text x="153" y="47" fontSize="9" fontWeight="700" fill="var(--ink-3)" textAnchor="middle" style={{ fontFamily: "var(--font-sans)" }}>
        ON
      </text>

      {/* LED */}
      <circle cx="76" cy="48" r="5.5" fill={ledFill} stroke="var(--ink)" strokeWidth="1.5" />
      {led !== "off" ? <circle cx="76" cy="48" r="11" fill={ledFill} opacity="0.22" /> : null}

      {/* paddle alias */}
      {alias ? (
        <text x="76" y="82" fontSize="15" fontWeight="800" fill="var(--ink-2)" textAnchor="middle" style={{ fontFamily: "var(--font-sans)", fontStretch: "80%" }}>
          {alias}
        </text>
      ) : null}

      {/* BID button */}
      <circle cx="76" cy="128" r="30" fill="var(--ink)" opacity={pressed ? 0 : 0.18} />
      <circle cx="76" cy={pressed ? 128 : 125} r="27" fill="var(--paddle)" stroke="var(--ink)" strokeWidth="3" />
      <text x="76" y={pressed ? 134 : 131} fontSize="16" fontWeight="800" fill="var(--paddle-ink)" textAnchor="middle" style={{ fontFamily: "var(--font-sans)", fontStretch: "110%" }}>
        BID
      </text>
    </svg>
  );
}
