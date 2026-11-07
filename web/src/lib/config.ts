/**
 * Runtime configuration, read from NEXT_PUBLIC_* env vars at build time.
 *
 * With no engine URL set, live pages run the labelled in-browser simulation.
 * With ARKIV_MODE unset (or "sample"), Arkiv pages read bundled sample data.
 * Set NEXT_PUBLIC_ARKIV_MODE=live to read the Arkiv testnet instead.
 */

const trimSlash = (value: string | undefined) => value?.replace(/\/+$/, "") || undefined;

export const config = {
  /**
   * The engine, as the browser reaches it: a full ws(s):// URL (Vercel: the tunnel), or a path on this
   * site such as "/engine" when the site runs on the engine's laptop and passes that path through to it
   * (next.config.ts, ENGINE_URL). With a path, a phone needs only the site's own address.
   */
  engineWsUrl: trimSlash(process.env.NEXT_PUBLIC_ENGINE_WS_URL),
  /** Falls back to the WebSocket URL with ws -> http, so one variable is enough. */
  engineHttpUrl:
    trimSlash(process.env.NEXT_PUBLIC_ENGINE_HTTP_URL) ?? trimSlash(process.env.NEXT_PUBLIC_ENGINE_WS_URL)?.replace(/^ws/, "http"),

  arkivMode: (process.env.NEXT_PUBLIC_ARKIV_MODE === "live" ? "live" : "sample") as "live" | "sample",
  /** Read-only access key for the public Arkiv RPC. It ships to the browser, so never reuse a write key here. */
  arkivAccessKey: process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? "",
  /** Set to "/api/arkiv-rpc" to send Arkiv reads through this site, which adds its key server-side (no key in the browser). */
  arkivRpcPath: trimSlash(process.env.NEXT_PUBLIC_ARKIV_RPC_PATH),
  arkivChainId: Number(process.env.NEXT_PUBLIC_ARKIV_CHAIN_ID ?? 7794095),
  arkivExplorerUrl: trimSlash(process.env.NEXT_PUBLIC_ARKIV_EXPLORER_URL) ?? "https://rabdi.explorer.arkiv.network",

  /** The Bid3 publisher wallet. Results written by any other wallet are flagged as unverified. */
  publisherAddress: (process.env.NEXT_PUBLIC_PUBLISHER_ADDRESS ?? "0xB1d3000000000000000000000000000000000B1d").toLowerCase(),

  /** The auction shown on the home page and in the header's "Live room" link. */
  featuredAuctionId: process.env.NEXT_PUBLIC_FEATURED_AUCTION_ID ?? "bid3-003",
} as const;

/** Link to an entity on the Arkiv explorer. Confirm the path format against the explorer before the demo. */
export const explorerEntityUrl = (entityKey: string) => `${config.arkivExplorerUrl}/entity/${entityKey}`;

/** The engine's WebSocket URL for `path` (browser only). A path-only engine URL is resolved against this page. */
export function engineSocketUrl(path: string): string {
  const base = config.engineWsUrl ?? "";
  if (!base.startsWith("/")) return `${base}${path}`;
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}${base}${path}`;
}

/** Where the browser sends Arkiv reads: this site's pass-through when configured, else the chain's own RPC (undefined). */
export const arkivReadUrl = (): string | undefined =>
  config.arkivRpcPath && typeof window !== "undefined" ? `${window.location.origin}${config.arkivRpcPath}` : undefined;

export const isSimulation = !config.engineWsUrl;
export const isSampleArkiv = config.arkivMode === "sample";
