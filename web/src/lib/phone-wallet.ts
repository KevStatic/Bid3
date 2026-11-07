"use client";

import { createPublicClient, createWalletClient, fallback, formatEther, http, keccak256, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { traceReset, traceStep } from "./payments";
import { bindMessage, type Payment } from "./payments-shared";

/**
 * The phone wallet: a Sepolia wallet the seat page creates in the phone's own browser the first time a
 * paddle is tapped. It needs no wallet app and no prompts, so linking is one tap and the winner's
 * payment goes out by itself at the hammer.
 *
 * The key lives only in this browser's storage. It's meant for a testnet demo: clearing the browser's
 * data loses the wallet (and any Sepolia ETH on it). Different browsers on one phone (Safari, Chrome,
 * MetaMask's browser) each get their own wallet.
 */

const KEY = "bid3.phoneWallet.v1";
const SENT = (auctionId: string) => `bid3.paid.${auctionId}`;

const transport = fallback([
  http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 10_000 }),
  http("https://sepolia.drpc.org", { timeout: 10_000 }),
]);
const reader = createPublicClient({ chain: sepolia, transport });

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // private mode or blocked storage
  }
}

/** This browser's wallet, created on first use. Null where storage is unavailable. */
export function phoneWallet(): PrivateKeyAccount | null {
  const store = storage();
  if (!store) return null;
  try {
    let key = store.getItem(KEY) as Hex | null;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      key = generatePrivateKey();
      store.setItem(KEY, key);
      if (store.getItem(KEY) !== key) return null; // storage refused the write
    }
    return privateKeyToAccount(key);
  } catch {
    return null;
  }
}

export async function phoneBalance(address: Hex): Promise<bigint> {
  return reader.getBalance({ address });
}

/** POST JSON, retrying a request that never got an answer (a dropped connection on a phone). */
async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
    }
  }
  throw new Error(`Couldn't reach the site (${(lastError as Error)?.message ?? "network error"}). Check the phone's connection and try again.`);
}

/** Links this phone's wallet to the paddle: signed here, checked by the site. */
export async function linkPhoneWallet(alias: string): Promise<Hex> {
  traceReset(`link Paddle ${alias} to this phone's wallet`);
  const account = phoneWallet();
  if (!account) throw new Error("This browser won't keep a wallet (private mode?). Open the page in a normal tab.");
  const issuedAtMs = Date.now();
  const signature = await account.signMessage({ message: bindMessage(alias, account.address, issuedAtMs) });
  traceStep(`signed as ${account.address}`);
  const { ok, status, data } = await postJson("/api/bind", { alias, wallet: account.address, issuedAtMs, signature });
  traceStep(`site answered ${status}${ok ? "" : `: ${String(data.error ?? "")}`}`);
  if (!ok) throw new Error(typeof data.error === "string" ? data.error : `The site answered ${status}.`);
  return account.address;
}

/** The signed payment this phone made for a lot, if any. Kept so a retry or reload never pays twice. */
function signedFor(auctionId: string): { hash: Hex; raw: Hex } | null {
  try {
    const value = JSON.parse(storage()?.getItem(SENT(auctionId)) ?? "null") as { hash?: string; raw?: string } | null;
    return value?.hash && value.raw ? { hash: value.hash as Hex, raw: value.raw as Hex } : null;
  } catch {
    return null;
  }
}

export const sentFor = (auctionId: string): Hex | null => signedFor(auctionId)?.hash ?? null;

/**
 * Pays a DUE payment from this phone's wallet: value = amountWei, data = the lot's memo, to the seller.
 * Sends at most once per lot from this browser; a second call returns the first transaction.
 */
export async function payFromPhone(payment: Payment): Promise<Hex> {
  traceReset(`pay ${payment.auctionId}: ${formatEther(BigInt(payment.amountWei))} ETH to ${payment.payee}`);
  const account = phoneWallet();
  if (!account) throw new Error("This browser has no phone wallet.");
  if (!payment.payee) throw new Error("The lot has no seller wallet.");
  if (!payment.payer || payment.payer.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("This lot is paid from the wallet on the phone that linked the paddle.");
  }
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const already = signedFor(payment.auctionId);
  if (already) {
    traceStep(`already signed ${already.hash}`);
    // Sepolia already has it (pending or mined): nothing to send.
    if (await reader.getTransaction({ hash: already.hash }).catch(() => null)) return already.hash;
    // Otherwise broadcast the same signed transaction again: same nonce, so it can only ever be included once.
    try {
      await wallet.sendRawTransaction({ serializedTransaction: already.raw });
      return already.hash;
    } catch (error) {
      if (isNetworkError(error) || /already known|nonce too low/i.test(`${(error as Error).message}`)) return already.hash;
      storage()?.removeItem(SENT(payment.auctionId)); // Sepolia refused it: sign a fresh one below
    }
  }

  const amount = BigInt(payment.amountWei);
  const balance = await reader.getBalance({ address: account.address });
  traceStep(`balance ${formatEther(balance)} Sepolia ETH`);
  if (balance <= amount) {
    throw new Error(`This phone's wallet needs Sepolia ETH: it has ${formatEther(balance)} and must pay ${formatEther(amount)} plus gas.`);
  }
  try {
    // Sign first and keep it, then broadcast: if the connection drops after sending, a retry resends this exact one.
    const request = await wallet.prepareTransactionRequest({ to: payment.payee as Hex, value: amount, data: stringToHex(payment.memo) });
    const raw = await wallet.signTransaction(request);
    const hash = keccak256(raw);
    storage()?.setItem(SENT(payment.auctionId), JSON.stringify({ hash, raw }));
    traceStep(`signed ${hash}, sending`);
    await wallet.sendRawTransaction({ serializedTransaction: raw });
    traceStep("sent to Sepolia");
    return hash;
  } catch (error) {
    traceStep(`send failed: ${(error as Error).name} ${(error as { shortMessage?: string }).shortMessage ?? (error as Error).message}`);
    // Keep the signed payment only if it may have gone out (the connection dropped); a refused one is dropped.
    if (!isNetworkError(error)) storage()?.removeItem(SENT(payment.auctionId));
    const text = `${(error as { shortMessage?: string }).shortMessage ?? ""} ${(error as Error).message ?? ""}`;
    if (/insufficient funds|exceeds the balance|exceeds balance/i.test(text)) {
      throw new Error("This phone's wallet doesn't have enough Sepolia ETH for the payment and gas. Add some and try again.");
    }
    throw new Error((error as { shortMessage?: string }).shortMessage ?? (error as Error).message ?? "The payment couldn't be sent.");
  }
}

const isNetworkError = (error: unknown) => /HttpRequestError|TimeoutError|TypeError/.test((error as Error)?.name ?? "");

/** Reports the transaction and waits (up to ~3 min) until the site has checked it on Sepolia. */
export async function confirmPhonePayment(auctionId: string, txHash: string): Promise<Payment> {
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const { ok, status, data } = await postJson("/api/pay", { auctionId, txHash });
    traceStep(`site check: ${ok ? String(data.state) : String(data.error ?? status)}`);
    if (!ok) throw new Error(typeof data.error === "string" ? data.error : `The site answered ${status}.`);
    if (data.payment && data.state !== "pending") return data.payment as Payment;
    if (Date.now() > deadline) throw new Error("Sepolia hasn't confirmed the payment yet. It's sent; check it on Etherscan.");
    await new Promise((r) => setTimeout(r, 4_000));
  }
}
