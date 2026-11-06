import { adminErrorResponse, requireAdmin } from "@/lib/admin/server";

/** Checks the admin password (and that the server has what it needs) without changing anything. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
