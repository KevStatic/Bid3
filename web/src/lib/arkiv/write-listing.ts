"use client";

import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { custom, type EIP1193Provider } from "viem";
import { config } from "../config";
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

  try {
    // The write is refused unless the wallet is on Rabdi, so switch first (adding the network the first time).
    const current = Number.parseInt(await provider.request({ method: "eth_chainId" }), 16);
    if (current !== chain.id) {
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
      } catch (error) {
        const code = (error as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (error as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
        if (code !== 4902) throw error; // 4902: the wallet doesn't know Rabdi yet
        await wallet.addChain({ chain });
      }
    }
    return await write(wallet, draft, seller);
  } catch (error) {
    throw new Error(friendlyWalletError(error));
  }
}

/** Turns the common wallet failures into something a seller can act on. */
function friendlyWalletError(error: unknown): string {
  const text = `${(error as { shortMessage?: string }).shortMessage ?? ""} ${error instanceof Error ? error.message : String(error)}`.toLowerCase();
  if (text.includes("insufficient funds") || text.includes("exceeds balance") || text.includes("gas required exceeds")) {
    return "Your wallet has no testnet gas (tGLM) on Rabdi. Get free test tokens at hub.arkiv.network/faucet, then publish again.";
  }
  if (text.includes("user rejected") || text.includes("user denied") || text.includes("rejected the request")) return "You cancelled the request in your wallet.";
  if (text.includes("does not match the target chain") || text.includes("chain mismatch")) return "Switch your wallet to the Arkiv Rabdi network, then publish again.";
  return error instanceof Error ? error.message : "The wallet didn't sign the listing.";
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
