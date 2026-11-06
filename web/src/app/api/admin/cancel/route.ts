import { adminErrorResponse, cancelLot, requireAdmin } from "@/lib/admin/server";

/** The auctioneer withdraws the running lot. It closes CANCELLED and its result is published. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = (await request.json().catch(() => null)) as { auctionId?: unknown } | null;
    await cancelLot(body?.auctionId);
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
