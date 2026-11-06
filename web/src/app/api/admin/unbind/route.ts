import { adminErrorResponse, requireAdmin } from "@/lib/admin/server";
import { clearBinding } from "@/lib/payments-server";

/** The auctioneer unlinks a paddle's wallet (refused while that paddle has bid on the live lot or owes a payment). */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    await clearBinding(await request.json().catch(() => null));
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
