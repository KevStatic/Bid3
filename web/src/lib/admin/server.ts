/**
 * Server-side helpers for the admin routes (app/api/admin/*). They run only on the server: the
 * engine's ADMIN_TOKEN and the admin page's ADMIN_PASSWORD are plain server env vars on Vercel and
 * never reach a browser. The engine is reached through the same tunnel URL the site already uses.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { PADDLE_ROSTER } from "./paddles";

const CLOSED_PHASES = new Set(["SOLD_LOCKED", "UNSOLD", "CANCELLED"]);

/** House rules for every lot the admin starts. The seller sets only the opening bid. */
const STEP_BPS = 500;
const COUNTDOWN_MS = 10_000;
const CEILING_TIMES_OPENING = 10;
export const NO_BID_LIMITS_MS = [60_000, 120_000, 300_000, 600_000] as const;

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminError) return Response.json({ error: error.message }, { status: error.status });
  console.error("admin route failed", error);
  return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
}

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Throws unless the request carries the admin password. */
export function requireAdmin(request: Request): void {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !process.env.ADMIN_TOKEN || !config.engineHttpUrl) {
    throw new AdminError(503, "The admin page isn't set up yet: add ADMIN_PASSWORD and ADMIN_TOKEN to the Vercel project and redeploy.");
  }
  if (!timingSafeEqual(digest(request.headers.get("x-admin-password") ?? ""), digest(password))) {
    throw new AdminError(401, "Wrong admin password.");
  }
}

/** For the public payment routes: they need the engine and its token, but no admin password. */
export function requireEngine(): void {
  if (!process.env.ADMIN_TOKEN || !config.engineHttpUrl) {
    throw new AdminError(503, "Payments aren't set up on this site yet (ADMIN_TOKEN or the engine URL is missing).");
  }
}

/** Calls the engine with the operator token. Engine refusals (400/409) come back as 409 with the engine's reason. */
export async function engine(path: string, method: "GET" | "POST" = "GET", json?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${config.engineHttpUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
        ...(json === undefined ? {} : { "content-type": "application/json" }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AdminError(502, "Can't reach the engine. Check the laptop is online and the tunnel is running (scripts/tunnel.sh).");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : `The engine answered ${response.status}.`;
    throw new AdminError(response.status === 400 || response.status === 409 ? 409 : response.status === 404 ? 404 : 502, detail);
  }
  return body;
}

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface StartInput {
  auctionId: string;
  listingId: string;
  category: string;
  startPriceMinor: number;
  timeLimitMs: number;
  /** The listing's seller wallet: a payment for this lot goes there. */
  sellerAddress?: string;
}

export function parseStartInput(body: unknown): StartInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const input = {
    auctionId: b.auctionId,
    listingId: b.listingId,
    category: typeof b.category === "string" ? b.category.slice(0, 40) : "Other",
    startPriceMinor: b.startPriceMinor,
    timeLimitMs: b.timeLimitMs,
    sellerAddress: typeof b.sellerAddress === "string" && ADDRESS.test(b.sellerAddress) ? b.sellerAddress : undefined,
  };
  if (typeof input.auctionId !== "string" || !ID.test(input.auctionId)) throw new AdminError(400, "Missing or invalid auctionId.");
  if (typeof input.listingId !== "string" || !ID.test(input.listingId)) throw new AdminError(400, "Missing or invalid listingId.");
  if (typeof input.startPriceMinor !== "number" || !Number.isInteger(input.startPriceMinor) || input.startPriceMinor <= 0 || input.startPriceMinor > 1e9) {
    throw new AdminError(400, "The opening bid must be a positive whole number of minor units.");
  }
  if (!NO_BID_LIMITS_MS.includes(input.timeLimitMs as (typeof NO_BID_LIMITS_MS)[number])) throw new AdminError(400, "Pick one of the no-bid timers.");
  return input as StartInput;
}

/** Opens bidding on a listed lot: refuses while another lot is still running (one live lot at a time). */
export async function startLot(input: StartInput): Promise<{ auctionId: string; phase: string }> {
  const health = await engine("/health");
  const activeId = typeof health.activeAuctionId === "string" ? health.activeAuctionId : null;
  if (activeId) {
    const active = await engine(`/auctions/${encodeURIComponent(activeId)}`);
    const phase = (active.state as { phase?: string } | undefined)?.phase;
    if (phase && !CLOSED_PHASES.has(phase)) {
      throw new AdminError(409, `Lot ${activeId} is still running (${phase}). Wait for the hammer, or withdraw it first.`);
    }
  }
  await engine("/auctions", "POST", {
    auctionId: input.auctionId,
    listingId: input.listingId,
    category: input.category,
    rules: {
      startPriceMinor: input.startPriceMinor,
      stepBps: STEP_BPS,
      countdownMs: COUNTDOWN_MS,
      ceilingMinor: input.startPriceMinor * CEILING_TIMES_OPENING,
      timeLimitMs: input.timeLimitMs,
      unit: "credits",
    },
    seats: PADDLE_ROSTER,
    ...(input.sellerAddress ? { sellerAddress: input.sellerAddress } : {}),
  });
  const opened = await engine(`/auctions/${encodeURIComponent(input.auctionId)}/open`, "POST");
  return { auctionId: input.auctionId, phase: String((opened.state as { phase?: string } | undefined)?.phase ?? "OPEN") };
}

export async function cancelLot(auctionId: unknown): Promise<void> {
  if (typeof auctionId !== "string" || !ID.test(auctionId)) throw new AdminError(400, "Missing or invalid auctionId.");
  await engine(`/auctions/${encodeURIComponent(auctionId)}/cancel`, "POST", { reason: "Withdrawn by the auctioneer" });
}
