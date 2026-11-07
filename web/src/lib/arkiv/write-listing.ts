"use client";

import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { custom, stringToHex, type EIP1193Provider } from "viem";
import { config } from "../config";
import { shortAddress } from "../format";
import { listingMessage, type ListingFields } from "../listing-shared";
import { traceReset, traceStep } from "../payments";
import { ItemListing } from "./schemas";

export interface ListingDraft {
  listingId: string;
  lotNumber: number;
  auctionId: string;
  title: string;
  category: string;
  condition: string;
  description: string;
  imageUrl?: string;
  sellerAlias: string;
  startPriceMinor: number;
  closesAtMs: number;
}

export interface PublishOutcome {
  entityKey: string;
  txHash: string;
  simulated: boolean;
}

export interface ListOutcome {
  listingId: string;
  simulated: boolean;
}

/**
 * Sell without Rabdi: the seller's wallet signs the listing (free, on whatever network it's on, e.g.
 * Sepolia), and Bid3 writes it to Arkiv and makes the seller's wallet its owner (app/api/list).
 */
export async function listItem(draft: ListingDraft, seller: `0x${string}`): Promise<ListOutcome> {
  if (config.arkivMode !== "live" || !config.engineHttpUrl) {
    await new Promise((r) => setTimeout(r, 900));
    return { listingId: draft.listingId, simulated: true };
  }
  const provider = (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No browser wallet found.");
  traceReset(`list "${draft.title}" from ${seller}`);
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    traceStep(`wallet network ${Number.parseInt(await provider.request({ method: "eth_chainId" }), 16)}, accounts: ${accounts.join(", ") || "none"}`);
    if (!accounts.some((a) => a.toLowerCase() === seller.toLowerCase())) {
      throw new Error(`Switch MetaMask to ${shortAddress(seller)}, the account connected here, then publish again.`);
    }
    const fields: ListingFields = {
      listingId: draft.listingId,
      auctionId: draft.auctionId,
      lotNumber: draft.lotNumber,
      title: draft.title,
      category: draft.category,
      condition: draft.condition,
      description: draft.description,
      sellerAlias: draft.sellerAlias,
      startPriceMinor: draft.startPriceMinor,
      closesAtMs: draft.closesAtMs,
    };
    const issuedAtMs = Date.now();
    const signature = await provider.request({ method: "personal_sign", params: [stringToHex(listingMessage(fields, seller, issuedAtMs)), seller] });
    traceStep("signed the listing");
    const response = await fetch("/api/list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing: fields, seller, issuedAtMs, signature }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    traceStep(`site answered ${response.status}${response.ok ? "" : `: ${data.error ?? ""}`}`);
    if (!response.ok) throw new Error(data.error ?? `The site answered ${response.status}.`);
    return { listingId: fields.listingId, simulated: false };
  } catch (error) {
    traceStep(`failed: ${causeChain(error)}`);
    throw new Error(friendlyWalletError(error));
  }
}

/** Listings stay public for a day after the auction closes. */
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Writes the listing from the seller's own wallet, so the seller owns the entity.
 * In sample mode nothing is sent; the outcome is marked simulated.
 */
export async function publishListing(draft: ListingDraft, seller: `0x${string}`): Promise<PublishOutcome> {
  if (config.arkivMode !== "live") {
    await new Promise((r) => setTimeout(r, 900));
    const fake = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    return { entityKey: fake, txHash: fake, simulated: true };
  }

  const provider = (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No browser wallet found.");

  const chain = rabdi({ accessKey: config.arkivAccessKey });
  const wallet = createWalletClient({ chain, transport: custom(provider), account: seller });

  traceReset(`publish "${draft.title}" from ${seller}`);
  try {
    // The write is refused unless the wallet is on Rabdi, so switch first (adding the network the first time).
    const current = Number.parseInt(await provider.request({ method: "eth_chainId" }), 16);
    traceStep(`wallet network before: ${current}`);
    if (current !== chain.id) {
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
      } catch (error) {
        const code = (error as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (error as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
        if (code !== 4902) throw error; // 4902: the wallet doesn't know Rabdi yet
        traceStep("Rabdi isn't in the wallet yet: adding it");
        await wallet.addChain({ chain });
      }
      traceStep(`wallet network now: ${Number.parseInt(await provider.request({ method: "eth_chainId" }), 16)}`);
    }
    // MetaMask shares accounts with a site per network: ask again on Rabdi, or it refuses to sign there.
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    traceStep(`accounts shared on Rabdi: ${accounts.join(", ") || "none"}`);
    if (!accounts.some((a) => a.toLowerCase() === seller.toLowerCase())) {
      throw new Error(`Switch MetaMask to ${shortAddress(seller)}, the account connected here, then publish again.`);
    }
    traceStep("asking the wallet to sign the listing");
    const outcome = await write(wallet, draft, seller);
    traceStep(`written: ${outcome.entityKey}`);
    return outcome;
  } catch (error) {
    traceStep(`failed: ${causeChain(error)}`);
    throw new Error(friendlyWalletError(error));
  }
}

/** Every message in the error and its causes. The SDK wraps the wallet's real reason in a generic one. */
function causeChain(error: unknown): string {
  const parts: string[] = [];
  for (let e = error as { shortMessage?: string; details?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 8; depth++) {
    for (const part of [e.shortMessage, e.details, e.message?.split("\n")[0]]) if (part && !parts.includes(part)) parts.push(part);
    e = e.cause as typeof e;
  }
  return parts.join(" <- ");
}

/** Turns the common wallet failures into something a seller can act on. */
function friendlyWalletError(error: unknown): string {
  const full = causeChain(error);
  const text = full.toLowerCase();
  if (text.includes("insufficient funds") || text.includes("exceeds balance") || text.includes("gas required exceeds")) {
    return "Your wallet has no testnet gas (tGLM) on Rabdi. Get free test tokens at hub.arkiv.network/faucet, then publish again.";
  }
  if (text.includes("user rejected") || text.includes("user denied") || text.includes("rejected the request")) return "You cancelled the request in your wallet.";
  if (text.includes("does not match the target chain") || text.includes("chain mismatch")) return "Switch your wallet to the Arkiv Rabdi network, then publish again.";
  if (text.includes("must provide") || text.includes("unauthorized") || text.includes("not been authorized")) {
    return "MetaMask hasn't allowed this site to use your account on Rabdi. Click Publish again and approve the connection; if it repeats, disconnect bid3.vercel.app in MetaMask and reconnect.";
  }
  // Show the wallet's own reason rather than the SDK's generic "Execution error without revert data".
  return full || "The wallet didn't sign the listing.";
}

async function write(wallet: ReturnType<typeof createWalletClient>, draft: ListingDraft, seller: `0x${string}`): Promise<PublishOutcome> {
  const { entityKey, txHash } = await wallet.createEntity(
    ItemListing,
    {
      listingId: draft.listingId,
      lotNumber: u64(draft.lotNumber),
      category: draft.category,
      status: "UPCOMING",
      startPriceMinor: u64(draft.startPriceMinor),
      closesAtMs: u64(draft.closesAtMs),
      auctionId: draft.auctionId,
      sellerAlias: draft.sellerAlias,
      sellerAddress: addr(seller),
      title: draft.title,
      description: draft.description,
      condition: draft.condition,
      ...(draft.imageUrl ? { imageUrl: draft.imageUrl } : {}),
    },
    { expiration: ExpirationTime.atDate(new Date(draft.closesAtMs + REVIEW_WINDOW_MS)) },
  );

  return { entityKey, txHash, simulated: false };
}
