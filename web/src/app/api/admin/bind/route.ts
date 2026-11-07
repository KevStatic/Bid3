import { adminErrorResponse, requireAdmin } from "@/lib/admin/server";
import { adminLinkWallet } from "@/lib/payments-server";

/** The auctioneer links a paddle to a wallet address (one of the team's real accounts). */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    await adminLinkWallet(await request.json().catch(() => null));
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
