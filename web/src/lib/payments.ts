"use client";

import { useQuery } from "@tanstack/react-query";
import { formatEther, numberToHex, stringToHex, type EIP1193Provider, type Hex } from "viem";
import { config } from "./config";
import { shortAddress } from "./format";
import { bindMessage, SEPOLIA, type Binding, type Payment, type PaymentSettings } from "./payments-shared";

export * from "./payments-shared";

/** Free Sepolia ETH for gas (a Google account is enough). */
export const SEPOLIA_FAUCET = "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";

async function engineGet<T>(path: string): Promise<T | null> {
  const response = await fetch(`${config.engineHttpUrl}${path}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`engine ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** The payment for one lot, or null if it has none (not sold, or payments off). */
export function usePayment(auctionId: string | null) {
  return useQuery({
    queryKey: ["engine", "payment", auctionId],
    enabled: !!config.engineHttpUrl && !!auctionId,
    refetchInterval: 4_000,
    queryFn: () => engineGet<Payment>(`/auctions/${encodeURIComponent(auctionId!)}/payment`),
  });
}

/** Recent payments, newest first. */
export function usePayments() {
  return useQuery({
    queryKey: ["engine", "payments"],
    enabled: !!config.engineHttpUrl,
    refetchInterval: 5_000,
    queryFn: async () => (await engineGet<Payment[]>("/payments?limit=50")) ?? [],
  });
}

/** Which wallet each paddle pays from. Empty if the engine predates payments. */
export function useBindings() {
  return useQuery({
    queryKey: ["engine", "bindings"],
    enabled: !!config.engineHttpUrl,
    refetchInterval: 5_000,
    queryFn: async () => (await engineGet<Record<string, Binding>>("/bindings")) ?? {},
  });
}

export function usePaymentSettings() {
  return useQuery({
    queryKey: ["engine", "payment-settings"],
    enabled: !!config.engineHttpUrl,
    refetchInterval: 15_000,
    queryFn: () => engineGet<PaymentSettings>("/payments/settings"),
  });
}

// ------------------------------------------------------------------ the bidder's wallet

function provider(): EIP1193Provider | null {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null;
}

export const hasBrowserWallet = () => provider() !== null;

/** Opens this page inside MetaMask's own browser on a phone, where the wallet is available. */
export const openInMetaMaskUrl = (path: string) =>
  `https://metamask.app.link/dapp/${typeof window === "undefined" ? "bid3.vercel.app" : window.location.host}${path}`;

async function requestAccount(): Promise<Hex> {
  const p = provider();
  if (!p) throw new Error("No wallet in this browser. Open this page in MetaMask's browser.");
  const [account] = (await p.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!account) throw new Error("The wallet didn't share an account.");
  return account;
}

function friendly(error: unknown): Error {
  const text = `${(error as { message?: string })?.message ?? error}`;
  const code = (error as { code?: number })?.code;
  if (code === 4001 || /user (rejected|denied)|rejected the request/i.test(text)) return new Error("You cancelled in your wallet.");
  if (/insufficient funds|exceeds balance/i.test(text)) {
    return new Error("Your wallet needs a little Sepolia ETH for gas. Get some free from the Sepolia faucet, then pay again.");
  }
  return error instanceof Error ? error : new Error(text);
}

/** Signs the link message (no gas) and asks the site to link this wallet to the paddle. */
export async function linkMyWallet(alias: string): Promise<string> {
  try {
    const p = provider()!;
    const wallet = await requestAccount();
    const issuedAtMs = Date.now();
    const signature = await p.request({ method: "personal_sign", params: [stringToHex(bindMessage(alias, wallet, issuedAtMs)), wallet] });
    const response = await fetch("/api/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias, wallet, issuedAtMs, signature }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? `The site answered ${response.status}.`);
    return wallet;
  } catch (error) {
    throw friendly(error);
  }
}

async function switchToSepolia(p: EIP1193Provider) {
  const current = Number.parseInt((await p.request({ method: "eth_chainId" })) as string, 16);
  if (current === SEPOLIA.id) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA.hexId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA.hexId,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: [SEPOLIA.explorer],
        },
      ],
    });
  }
}

/** Sends the payment from the winner's wallet to the seller on Sepolia. Returns the transaction hash. */
export async function sendPayment(payment: Payment): Promise<Hex> {
  try {
    const p = provider();
    if (!p) throw new Error("No wallet in this browser. Open this page in MetaMask's browser.");
    if (!payment.payer || !payment.payee) throw new Error("Link a wallet to this paddle first.");
    const account = await requestAccount();
    if (account.toLowerCase() !== payment.payer.toLowerCase()) {
      throw new Error(`Switch your wallet to ${shortAddress(payment.payer)}, the one linked to Paddle ${payment.winnerAlias}.`);
    }
    await switchToSepolia(p);
    return (await p.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: payment.payee as Hex, value: numberToHex(BigInt(payment.amountWei)), data: stringToHex(payment.memo) }],
    })) as Hex;
  } catch (error) {
    throw friendly(error);
  }
}

/** Reports the transaction and waits (up to ~3 min) until the site has checked it on Sepolia. */
export async function confirmPayment(auctionId: string, txHash: string): Promise<Payment> {
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const response = await fetch("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auctionId, txHash }),
    });
    const data = (await response.json().catch(() => ({}))) as { state?: string; payment?: Payment; error?: string };
    if (!response.ok) throw new Error(data.error ?? `The site answered ${response.status}.`);
    if (data.payment && data.state !== "pending") return data.payment;
    if (Date.now() > deadline) throw new Error("Sepolia hasn't confirmed the transaction yet. It's sent; check it on Etherscan.");
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

// ------------------------------------------------------------------ wording

export const formatEth = (wei: string) => `${formatEther(BigInt(wei))} ETH`;

/** One sentence on where a payment stands, for the room, the seat page and the lot lists. */
export function paymentSentence(p: Payment): string {
  const who = `Paddle ${p.winnerAlias}`;
  switch (p.status) {
    case "DUE":
      return p.payer
        ? `Waiting for ${who} to pay the seller ${formatEth(p.amountWei)} on Sepolia`
        : `Waiting for ${who} to link a wallet and pay the seller`;
    case "PAID":
      return `${who} paid the seller ${formatEth(p.amountWei)} on Sepolia`;
    case "UNPAID":
      return `Not paid (${(p.reason ?? "no payment").toLowerCase()}), so the lot stays with the seller`;
  }
}
