import { adminErrorResponse, requireEngine } from "@/lib/admin/server";
import { linkWallet } from "@/lib/payments-server";

/** A bidder links their wallet to a paddle (after tapping its NFC sticker). Checked by signature. */
export async function POST(request: Request) {
  try {
    requireEngine();
    await linkWallet(await request.json().catch(() => null));
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
