import type { Paddle } from "@/lib/types";

const STATUS: Record<Paddle["status"], { label: string; dot: string; text: string }> = {
  ACTIVE: { label: "Switched on", dot: "bg-live", text: "text-ink" },
  JOIN_PENDING: { label: "Joining…", dot: "bg-paddle animate-pulse-dot", text: "text-ink-2" },
  LEAVE_PENDING: { label: "Leaving…", dot: "bg-ink-3 animate-pulse-dot", text: "text-ink-2" },
  OUT: { label: "Switched off", dot: "bg-line-strong", text: "text-ink-3" },
  UNKNOWN: { label: "Signal lost", dot: "bg-halt animate-pulse-dot", text: "text-halt" },
};

export function PaddleRoster({ paddles, leaderAlias }: { paddles: Paddle[]; leaderAlias: string | null }) {
  return (
    <ul className="flex flex-col gap-2">
      {paddles.map((paddle) => {
        const s = STATUS[paddle.status];
        const leading = paddle.alias === leaderAlias;
        return (
          <li
            key={paddle.alias}
            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
              leading ? "border-paddle bg-paddle-soft" : "border-line bg-surface"
            }`}
          >
            <span className="flex items-center gap-3">
              <span
                className={`font-narrow tabular flex size-9 items-center justify-center rounded-full text-base font-extrabold ${
                  leading ? "bg-paddle text-paddle-ink" : "bg-surface-2 text-ink"
                }`}
                aria-hidden
              >
                {paddle.alias}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">Paddle {paddle.alias}</span>
                <span className={`flex items-center gap-1.5 text-sm ${s.text}`}>
                  <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
                  {s.label}
                </span>
              </span>
            </span>
            {leading ? <span className="text-sm font-bold text-ink">Leading</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
