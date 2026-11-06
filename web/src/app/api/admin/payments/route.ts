import { adminErrorResponse, requireAdmin } from "@/lib/admin/server";
import { setPaymentRate } from "@/lib/payments-server";

/** The auctioneer sets how much ETH each credit of the hammer price costs (0 = only gas). */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    return Response.json({ ok: true, settings: await setPaymentRate(await request.json().catch(() => null)) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
