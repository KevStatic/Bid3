import { adminErrorResponse, requireEngine } from "@/lib/admin/server";
import { reportPayment } from "@/lib/payments-server";

/** The winner's phone reports its Sepolia payment. Answers "pending" until the transaction is mined. */
export async function POST(request: Request) {
  try {
    requireEngine();
    return Response.json(await reportPayment(await request.json().catch(() => null)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
