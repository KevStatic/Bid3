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

/**
 * Opens this page inside MetaMask's own browser on a phone, where the wallet is available (browser only).
 * The link hands MetaMask the page itself (metamask://dapp/<host><path>), which MetaMask Mobile routes to
 * its browser. The https link (metamask.app.link/dapp/…) only works when the phone passes it straight to
 * the app: when it reaches Branch's server instead, the app gets a bare "open" link and shows "This page
 * doesn't exist" (seen on Android, Sat 7 Nov). On Android an intent link names the app and falls back to
 * the Play Store without MetaMask. MetaMask opens the page over https, so this works for the site's
 * public address, not for localhost.
 */
export function openInMetaMaskUrl(path: string): string {
  const target = `dapp/${window.location.host}${path}`;
  if (/android/i.test(navigator.userAgent)) {
    const store = encodeURIComponent("https://play.google.com/store/apps/details?id=io.metamask");
    return `intent://${target}#Intent;scheme=metamask;package=io.metamask;S.browser_fallback_url=${store};end`;
  }
  return `metamask://${target}`;
}

/** The account this site can already see in the wallet, without a prompt (null until the user connects). */
export async function connectedAccount(): Promise<Hex | null> {
  const p = provider();
  if (!p) return null;
  const [first] = (await p.request({ method: "eth_accounts" }).catch(() => [])) as Hex[];
  return first ? (first.toLowerCase() as Hex) : null;
}

/** Calls `onChange` when the user switches or disconnects accounts in the wallet. Returns an unsubscribe. */
export function onAccountsChanged(onChange: () => void): () => void {
  const p = provider();
  if (!p?.on) return () => {};
  p.on("accountsChanged", onChange);
  return () => p.removeListener?.("accountsChanged", onChange);
}

async function requestAccount(): Promise<Hex> {
  const p = provider();
  if (!p) throw new Error("No wallet in this browser. Open this page in MetaMask's browser.");
  const [account] = (await p.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!account) throw new Error("The wallet didn't share an account.");
  return account;
}

// ------------------------------------------------------------------ trace

/** Each step of the last link or payment attempt, shown under an error so a failure can be traced from the phone. */
const trace: string[] = [];
const note = (step: string) => {
  const line = `${new Date().toLocaleTimeString("en-GB")} ${step}`;
  trace.push(line);
  console.info("[bid3 payment]", line);
};
export const paymentTrace = () => [...trace];
/** For other wallet flows (the seller's listing): start a new trace, and add a step to it. */
export const traceReset = (first: string) => {
  trace.length = 0;
  note(first);
};
export const traceStep = (step: string) => note(step);

function friendly(error: unknown): Error {
  const text = `${(error as { message?: string })?.message ?? error}`;
  const code = (error as { code?: number })?.code;
  note(`failed: ${code ?? "no code"} ${text}`);
  if (code === 4001 || /user (rejected|denied)|rejected the request/i.test(text)) return new Error("You cancelled in your wallet.");
  if (/must provide an ethereum address|unauthorized/i.test(text)) {
    return new Error(
      `MetaMask hasn't shared this wallet with the site on Sepolia. Try again and approve the connection. If it repeats, open MetaMask's connected sites, disconnect ${typeof window === "undefined" ? "this site" : window.location.host}, reload this page and try again.`,
    );
  }
  if (/insufficient funds|exceeds balance/i.test(text)) {
    return new Error("Your wallet needs a little Sepolia ETH for gas. Get some free from the Sepolia faucet, then pay again.");
  }
  return error instanceof Error ? error : new Error(text);
}

/**
 * Links the wallet in this browser to the paddle: the wallet shares its account and signs a short
 * message (free, no gas), and the site saves exactly that address. Returns the address saved.
 */
export async function linkMyWallet(alias: string): Promise<Hex> {
  trace.length = 0;
  note(`link Paddle ${alias}`);
  try {
    const p = provider();
    if (!p) throw new Error("No wallet in this browser. Open this page in MetaMask's browser.");
    // Same order as paying: Sepolia first, then the account, so MetaMask Mobile (which shares accounts
    // per network) signs with an account it has shared on the network the paddle pays on.
    await switchToSepolia(p);
    note(`wallet network: ${Number.parseInt((await p.request({ method: "eth_chainId" })) as string, 16)}`);
    const wallet = (await requestAccount()).toLowerCase() as Hex;
    note(`account shared: ${wallet}`);
    const issuedAtMs = Date.now();
    note("asking the wallet to sign the link message");
    const signature = await p.request({ method: "personal_sign", params: [stringToHex(bindMessage(alias, wallet, issuedAtMs)), wallet] });
    note("signed; saving the address");
    const response = await fetch("/api/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias, wallet, issuedAtMs, signature }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    note(`site answered ${response.status}${response.ok ? "" : `: ${data.error ?? ""}`}`);
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
    trace.length = 0;
    note(`pay ${payment.auctionId}: ${payment.amountWei} wei to ${payment.payee}, due from ${payment.payer}`);
    const p = provider();
    if (!p) throw new Error("No wallet in this browser. Open this page in MetaMask's browser.");
    if (!payment.payer || !payment.payee) throw new Error("Link a wallet to this paddle first.");
    note(`wallet network before: ${Number.parseInt((await p.request({ method: "eth_chainId" })) as string, 16)}`);
    // Switch first, then ask for the account. MetaMask Mobile shares accounts with a site per network:
    // an account shared on another network is refused on Sepolia with "must provide an Ethereum address".
    await switchToSepolia(p);
    note(`wallet network now: ${Number.parseInt((await p.request({ method: "eth_chainId" })) as string, 16)}`);
    const account = await requestAccount();
    note(`account shared on Sepolia: ${account}`);
    if (account.toLowerCase() !== payment.payer.toLowerCase()) {
      throw new Error(`Switch your wallet to ${shortAddress(payment.payer)}, the one linked to Paddle ${payment.winnerAlias}.`);
    }
    const balance = BigInt((await p.request({ method: "eth_getBalance", params: [account, "latest"] })) as string);
    note(`Sepolia balance: ${formatEther(balance)} ETH`);
    if (balance <= BigInt(payment.amountWei)) {
      throw new Error(`This wallet has no Sepolia ETH for gas. Send a little Sepolia ETH to ${account}, then pay again.`);
    }
    note("asking the wallet to send");
    const hash = (await p.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: payment.payee as Hex, value: numberToHex(BigInt(payment.amountWei)), data: stringToHex(payment.memo) }],
    })) as Hex;
    note(`sent ${hash}`);
    return hash;
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
    if (!response.ok) {
      note(`site check refused: ${data.error ?? response.status}`);
      throw new Error(data.error ?? `The site answered ${response.status}.`);
    }
    note(`site check: ${data.state}`);
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
