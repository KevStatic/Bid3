import { adminErrorResponse, parseStartInput, requireAdmin, startLot } from "@/lib/admin/server";

/** The auctioneer declares bidding open on a listed lot. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const input = parseStartInput(await request.json().catch(() => null));
    return Response.json({ ok: true, ...(await startLot(input)) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
