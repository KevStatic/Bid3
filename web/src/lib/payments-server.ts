/**
 * Server side of paddle wallets and Sepolia payments (app/api/bind, app/api/pay).
 *
 * These routes are public: anyone can ask to link a wallet or report a payment. They only reach the
 * engine (with the operator token, which never leaves the server) after checking:
 * - linking: the wallet signed bindMessage() for this paddle in the last few minutes;
 * - paying: the Sepolia transaction is mined and successful, from the wallet the engine expects,
 *   to the seller, for at least the amount due, carrying this lot's memo.
 * The engine then re-checks the payer, payee, amount, window and that the transaction is unused.
 */
import { createPublicClient, http, isAddress, isAddressEqual, stringToHex, verifyMessage, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { AdminError, engine } from "@/lib/admin/server";
import { PADDLE_ROSTER } from "@/lib/admin/paddles";
import { BIND_MAX_AGE_MS, bindMessage, type Payment } from "@/lib/payments-shared";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 8_000 }),
});

export async function linkWallet(body: unknown): Promise<void> {
  const b = (body ?? {}) as Record<string, unknown>;
  const alias = typeof b.alias === "string" ? b.alias.toUpperCase() : "";
  const { wallet, signature, issuedAtMs } = b;
  if (!PADDLE_ROSTER.some((seat) => seat.alias === alias)) throw new AdminError(400, "There's no paddle with that name.");
  if (typeof wallet !== "string" || !isAddress(wallet)) throw new AdminError(400, "That isn't a wallet address.");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new AdminError(400, "The signature is missing.");
  if (typeof issuedAtMs !== "number" || Math.abs(Date.now() - issuedAtMs) > BIND_MAX_AGE_MS) {
    throw new AdminError(400, "That signature is too old. Tap Link my wallet again.");
  }
  const valid = await verifyMessage({ address: wallet, message: bindMessage(alias, wallet, issuedAtMs), signature: signature as Hex }).catch(() => false);
  if (!valid) throw new AdminError(400, "The signature doesn't match this wallet.");
  await engine("/bindings", "POST", { alias, wallet: wallet.toLowerCase() });
}

export type PayReply = { state: "pending" } | { state: "paid" | "closed"; payment: Payment };

/** Checks a reported Sepolia transaction against what the engine says is due, then records it. */
export async function reportPayment(body: unknown): Promise<PayReply> {
  const b = (body ?? {}) as Record<string, unknown>;
  const { auctionId, txHash } = b;
  if (typeof auctionId !== "string" || !ID.test(auctionId)) throw new AdminError(400, "Missing or invalid auctionId.");
  if (typeof txHash !== "string" || !TX_HASH.test(txHash)) throw new AdminError(400, "That isn't a transaction hash.");

  const due = (await engine(`/auctions/${encodeURIComponent(auctionId)}/payment`)) as unknown as Payment;
  if (due.status !== "DUE") return { state: "closed", payment: due };
  if (!due.payer || !due.payee) throw new AdminError(409, "Link a wallet to the winning paddle first.");

  const hash = txHash as Hex;
  const [tx, receipt] = await Promise.all([
    sepoliaClient.getTransaction({ hash }).catch(() => null),
    sepoliaClient.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) return { state: "pending" }; // not mined yet (or not seen by this RPC yet)
  if (receipt.status !== "success") throw new AdminError(409, "That transaction failed on Sepolia, so nothing was paid.");
  if (!isAddressEqual(tx.from, due.payer as Hex)) throw new AdminError(409, "That transaction wasn't sent from the wallet linked to the winning paddle.");
  if (!tx.to || !isAddressEqual(tx.to, due.payee as Hex)) throw new AdminError(409, "That transaction didn't go to the seller's wallet.");
  if (tx.value < BigInt(due.amountWei)) throw new AdminError(409, "That transaction paid less than the amount due.");
  if (tx.input.toLowerCase() !== stringToHex(due.memo).toLowerCase()) throw new AdminError(409, "That transaction isn't marked as the payment for this lot.");

  const payment = (await engine(`/auctions/${encodeURIComponent(auctionId)}/payment/paid`, "POST", {
    txHash: hash.toLowerCase(),
    payer: tx.from.toLowerCase(),
    payee: tx.to.toLowerCase(),
    amountWei: tx.value.toString(),
  })) as unknown as Payment;
  return { state: "paid", payment };
}

/** Admin: the rate in ETH per 1.00 credit, sent to the engine as wei. */
export async function setPaymentRate(body: unknown): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.ethPerCredit === "string" ? b.ethPerCredit.trim() : "";
  const match = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(text);
  if (!match) throw new AdminError(400, "Enter the ETH per credit as a plain number, like 0 or 0.000001.");
  const wei = BigInt(match[1]) * 10n ** 18n + BigInt((match[2] ?? "").padEnd(18, "0") || "0");
  return engine("/payments/settings", "POST", { weiPerCredit: wei.toString() });
}

export async function clearBinding(body: unknown): Promise<void> {
  const alias = typeof (body as { alias?: unknown })?.alias === "string" ? (body as { alias: string }).alias.toUpperCase() : "";
  if (!PADDLE_ROSTER.some((seat) => seat.alias === alias)) throw new AdminError(400, "There's no paddle with that name.");
  await engine(`/bindings/${encodeURIComponent(alias)}/clear`, "POST");
}

/**
 * Admin: link a paddle to a wallet address directly (e.g. one of the team's MetaMask accounts), with no
 * signature. The winner then pays from that account with "Pay with MetaMask". The engine still refuses
 * while the paddle has bid on the live lot or owes a payment.
 */
export async function adminLinkWallet(body: unknown): Promise<void> {
  const b = (body ?? {}) as Record<string, unknown>;
  const alias = typeof b.alias === "string" ? b.alias.toUpperCase() : "";
  const wallet = typeof b.wallet === "string" ? b.wallet.trim() : "";
  if (!PADDLE_ROSTER.some((seat) => seat.alias === alias)) throw new AdminError(400, "There's no paddle with that name.");
  if (!isAddress(wallet)) throw new AdminError(400, "That isn't a wallet address (0x followed by 40 characters).");
  await engine("/bindings", "POST", { alias, wallet: wallet.toLowerCase() });
}
