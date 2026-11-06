/** POSTs to an admin route with the password the auctioneer signed in with (held in memory only). */
export type Reply = { ok: true; phase?: string } | { ok: false; status: number; error: string };

export async function adminPost(path: string, password: string, body: unknown = {}): Promise<Reply> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "x-admin-password": password, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; phase?: string };
    return response.ok ? { ok: true, phase: data.phase } : { ok: false, status: response.status, error: data.error ?? `The server answered ${response.status}.` };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the website's server." };
  }
}
