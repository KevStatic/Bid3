const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMinor(minor: number): string {
  return priceFormatter.format(minor / 100);
}

/** "0x12ab…9f3c" */
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shortKey(key: string): string {
  return shortAddress(key, 8, 6);
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 3 hours", "2 minutes ago" */
export function fromNow(targetMs: number, nowMs: number = Date.now()): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return relative.format(Math.round(diff / 1000), "second");
  if (abs < hour) return relative.format(Math.round(diff / minute), "minute");
  if (abs < day) return relative.format(Math.round(diff / hour), "hour");
  return relative.format(Math.round(diff / day), "day");
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function clockTime(ms: number): string {
  return clock.format(new Date(ms));
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function shortDateTime(ms: number): string {
  return dateTime.format(new Date(ms));
}

export function percentFromBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function secondsLabel(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}
