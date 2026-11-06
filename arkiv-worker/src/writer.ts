import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str, u64 } from "@arkiv-network/sdk/schema";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { AuctionBid, AuctionDefinition, AuctionResult, AuctionSnapshot } from "./schemas.ts";

/**
 * Turns engine outbox records into Arkiv entities.
 *
 * Expiry and flags per entity type (documented in /arkiv/schema.md):
 *   AuctionDefinition  readonly, 30 days          frozen rules; nobody can edit them
 *   AuctionBid         readonly, 7 days           one per accepted press
 *   AuctionSnapshot    10 minutes                 room fallback; stale ones vanish
 *   AuctionResult      readonly, 90 days, anyone may extend   the record people check
 */

export interface OutboxItem {
  id: number;
  auctionId: string;
  kind: "AuctionDefinition" | "AuctionBid" | "AuctionSnapshot" | "AuctionResult";
  logicalId: string;
  attempts: number;
  payload: Record<string, unknown>;
}

export interface Written {
  entityKey: string;
  txHash: string | null;
  reused: boolean;
}

const num = (v: unknown) => u64(BigInt(Number(v ?? 0)));
const text = (v: unknown) => String(v ?? "");

export function createWriter() {
  const chain = rabdi({ accessKey: config.accessKey });
  const account = privateKeyToAccount(config.privateKey as Hex);
  const wallet = createWalletClient({ chain, transport: http(), account });
  const reader = createPublicClient({ chain, transport: http() });
  const owner = account.address;

  /**
   * After an uncertain failure the write may have landed anyway. Entity keys can't be
   * fixed in advance, so look for our own entity with the same logical identity first.
   */
  async function existing(item: OutboxItem): Promise<string | null> {
    const p = item.payload;
    switch (item.kind) {
      case "AuctionDefinition": {
        const page = await reader
          .select({ $key: true })
          .from(AuctionDefinition)
          .where(eq("auctionId", str(text(p.auctionId))), eq("epoch", num(p.epoch)))
          .ownedBy(owner)
          .limit(1)
          .fetch();
        return page.entities[0]?.$key ?? null;
      }
      case "AuctionBid": {
        const page = await reader
          .select({ $key: true })
          .from(AuctionBid)
          .where(eq("auctionId", str(text(p.auctionId))), eq("epoch", num(p.epoch)), eq("bidIndex", num(p.bidIndex)))
          .ownedBy(owner)
          .limit(1)
          .fetch();
        return page.entities[0]?.$key ?? null;
      }
      case "AuctionResult": {
        const page = await reader
          .select({ $key: true })
          .from(AuctionResult)
          .where(eq("auctionId", str(text(p.auctionId))), eq("epoch", num(p.epoch)))
          .ownedBy(owner)
          .limit(1)
          .fetch();
        return page.entities[0]?.$key ?? null;
      }
      case "AuctionSnapshot":
        return null; // superseded every few seconds; a duplicate is harmless
    }
  }

  async function create(item: OutboxItem): Promise<{ entityKey: string; txHash: string }> {
    const p = item.payload;
    switch (item.kind) {
      case "AuctionDefinition":
        return wallet.createEntity(
          AuctionDefinition,
          {
            auctionId: text(p.auctionId),
            epoch: num(p.epoch),
            listingId: text(p.listingId),
            rulesHash: text(p.rulesHash),
            startPriceMinor: num(p.startPriceMinor),
            stepBps: num(p.stepBps),
            countdownMs: num(p.countdownMs),
            ceilingMinor: num(p.ceilingMinor),
            timeLimitMs: num(p.timeLimitMs),
            unit: text(p.unit),
          },
          { expiration: ExpirationTime.fromDays(30), flags: { readonly: true } },
        );
      case "AuctionBid":
        return wallet.createEntity(
          AuctionBid,
          {
            auctionId: text(p.auctionId),
            epoch: num(p.epoch),
            bidIndex: num(p.bidIndex),
            priceMinor: num(p.priceMinor),
            bidderAlias: text(p.bidderAlias),
            serverSeq: num(p.serverSeq),
            acceptedAtMs: num(p.acceptedAtMs),
          },
          { expiration: ExpirationTime.fromDays(7), flags: { readonly: true } },
        );
      case "AuctionSnapshot":
        return wallet.createEntity(
          AuctionSnapshot,
          {
            auctionId: text(p.auctionId),
            serverSeq: num(p.serverSeq),
            phase: text(p.phase),
            priceMinor: num(p.priceMinor),
            ...(p.leaderAlias ? { leaderAlias: text(p.leaderAlias) } : {}),
            activeCount: num(p.activeCount),
            generatedAtMs: num(p.generatedAtMs),
          },
          { expiration: ExpirationTime.fromMinutes(10) },
        );
      case "AuctionResult":
        return wallet.createEntity(
          AuctionResult,
          {
            auctionId: text(p.auctionId),
            epoch: num(p.epoch),
            listingId: text(p.listingId),
            category: text(p.category),
            status: text(p.status),
            hammerPriceMinor: num(p.hammerPriceMinor),
            closedAtMs: num(p.closedAtMs),
            winnerAlias: text(p.winnerAlias),
            finalSeq: num(p.finalSeq),
            bidCount: num(p.bidCount),
            rulesHash: text(p.rulesHash),
            transcriptDigest: text(p.transcriptDigest),
          },
          { expiration: ExpirationTime.fromDays(90), flags: { readonly: true, permissionlessExtension: true } },
        );
    }
  }

  return {
    owner,
    async write(item: OutboxItem): Promise<Written> {
      if (item.attempts > 0) {
        const key = await existing(item);
        if (key) return { entityKey: key, txHash: null, reused: true };
      }
      const { entityKey, txHash } = await create(item);
      return { entityKey, txHash, reused: false };
    },
  };
}
