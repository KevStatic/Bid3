/**
 * Arkiv reads for a site that is open to the public (the laptop's site, through a tunnel). The browser
 * sends its JSON-RPC here (NEXT_PUBLIC_ARKIV_RPC_PATH=/api/arkiv-rpc) and this server forwards it to
 * ARKIV_RPC_URL, which carries the access key, so the key never reaches a browser. Only reads pass:
 * anything that sends or signs a transaction is refused. Unset on Vercel, which uses its own read-only key.
 */
const RPC = process.env.ARKIV_RPC_URL;
const NOT_A_READ = /^(eth_send|eth_sign|personal_|wallet_|admin_|debug_|miner_|txpool_|engine_)/;

export async function POST(request: Request) {
  if (!RPC) return Response.json({ error: "ARKIV_RPC_URL isn't set on this site." }, { status: 503 });
  const body: unknown = await request.json().catch(() => null);
  const calls = Array.isArray(body) ? body : [body];
  const readsOnly =
    calls.length > 0 &&
    calls.length <= 50 &&
    calls.every((c) => typeof c === "object" && c !== null && typeof (c as { method?: unknown }).method === "string" && !NOT_A_READ.test((c as { method: string }).method));
  if (!readsOnly) return Response.json({ error: "Only Arkiv reads are passed on." }, { status: 400 });

  try {
    const upstream = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  } catch {
    return Response.json({ error: "Arkiv didn't answer." }, { status: 502 });
  }
}
