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

  const wallet = createWalletClient({
    chain: rabdi({ accessKey: config.arkivAccessKey }),
    transport: custom(provider),
    account: seller,
  });

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
