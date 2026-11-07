import { adminErrorResponse, requireEngine } from "@/lib/admin/server";
import { submitListing } from "@/lib/listing-server";

/** A seller lists an item: checked by their wallet's signature, then written to Arkiv by Bid3 and handed to them. */
export async function POST(request: Request) {
  try {
    requireEngine();
    return Response.json({ ok: true, ...(await submitListing(await request.json().catch(() => null))) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
