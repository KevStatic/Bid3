import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { asc, desc, eq, gte, lte } from "@arkiv-network/sdk/query";
import { str, u64 } from "@arkiv-network/sdk/schema";
import { http } from "viem";
import { arkivReadUrl, config } from "../config";
import { pickListing } from "./pick-listing";
import { AuctionBid, AuctionDefinition, AuctionResult, AuctionSnapshot, ItemListing } from "./schemas";
import { sortListings } from "./sort";
import type { ArkivReader, BidRecord, Definition, Listing, ListingFilter, ListingStatus, Result, ResultStatus, Snapshot } from "./types";

/**
 * Reads Bid3 entities straight from the Arkiv testnet, in the browser.
 * No call goes through the Bid3 engine, so these pages keep working when it is down.
 */

const n = (value: bigint) => Number(value);
const lower = (address: string) => address.toLowerCase();

type ListingRow = {
  $key: string;
  $owner: string;
  listingId: { value: string };
  lotNumber: { value: bigint };
  category: { value: string };
  status: { value: string };
  startPriceMinor: { value: bigint };
  closesAtMs: { value: bigint };
  auctionId: { value: string };
  sellerAlias: { value: string };
  sellerAddress: { value: string };
  title: { value: string };
  description: { value: string };
  condition: { value: string };
  imageUrl?: { value: string };
};

function toListing(e: ListingRow): Listing {
  return {
    key: e.$key,
    owner: lower(e.$owner),
    listingId: e.listingId.value,
    lotNumber: n(e.lotNumber.value),
    category: e.category.value,
    status: e.status.value as ListingStatus,
    startPriceMinor: n(e.startPriceMinor.value),
    closesAtMs: n(e.closesAtMs.value),
    auctionId: e.auctionId.value,
    sellerAlias: e.sellerAlias.value,
    sellerAddress: lower(e.sellerAddress.value),
    title: e.title.value,
    description: e.description.value,
    condition: e.condition.value,
    imageUrl: e.imageUrl?.value,
  };
}

/** Only the Bid3 publisher wallet may write rules, bids, snapshots and results; ignore look-alikes from other wallets. */
const PUBLISHER = config.publisherAddress as `0x${string}`;

export class LiveArkivReader implements ArkivReader {
  readonly mode = "live" as const;
  private readonly client = createPublicClient({
    chain: rabdi({ accessKey: config.arkivAccessKey }),
    transport: http(arkivReadUrl()),
  });

  async listListings(filter: ListingFilter = {}): Promise<Listing[]> {
    // Each where() call adds a filter that must hold; all are indexed columns.
    let query = this.client.select().from(ItemListing);
    if (filter.category) query = query.where(eq("category", str(filter.category)));
    if (filter.status) query = query.where(eq("status", str(filter.status)));
    if (filter.minStartMinor !== undefined) query = query.where(gte("startPriceMinor", u64(filter.minStartMinor)));
    if (filter.maxStartMinor !== undefined) query = query.where(lte("startPriceMinor", u64(filter.maxStartMinor)));
    const page = await query.orderBy(asc("closesAtMs")).limit(100).fetch();
    return sortListings(page.entities.map(toListing), filter.sort ?? "closing");
  }

  async getListingByAuction(auctionId: string): Promise<Listing | null> {
    // Any wallet can write a listing with this auctionId, so fetch every candidate and let the
    // publisher's definition (which names the listingId) and pickListing's rules choose.
    const [page, definition] = await Promise.all([
      this.client.select().from(ItemListing).where(eq("auctionId", str(auctionId))).limit(50).fetch(),
      this.getDefinition(auctionId),
    ]);
    const candidates = page.entities.map((e) => ({ listing: toListing(e), createdAtBlock: e.$createdAt }));
    return pickListing(candidates, PUBLISHER, definition?.listingId);
  }

  async getDefinition(auctionId: string): Promise<Definition | null> {
    const page = await this.client
      .select()
      .from(AuctionDefinition)
      .ownedBy(PUBLISHER)
      .where(eq("auctionId", str(auctionId)))
      .orderBy(desc("epoch"))
      .limit(1)
      .fetch();
    const e = page.entities[0];
    if (!e) return null;
    return {
      key: e.$key,
      owner: lower(e.$owner),
      auctionId: e.auctionId.value,
      epoch: n(e.epoch.value),
      listingId: e.listingId.value,
      rulesHash: e.rulesHash.value,
      startPriceMinor: n(e.startPriceMinor.value),
      stepBps: n(e.stepBps.value),
      countdownMs: n(e.countdownMs.value),
      ceilingMinor: n(e.ceilingMinor.value),
      timeLimitMs: n(e.timeLimitMs.value),
      unit: e.unit.value,
    };
  }

  async listBids(auctionId: string): Promise<BidRecord[]> {
    const page = await this.client
      .select()
      .from(AuctionBid)
      .ownedBy(PUBLISHER)
      .where(eq("auctionId", str(auctionId)))
      .orderBy(desc("bidIndex"))
      .limit(100)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      owner: lower(e.$owner),
      auctionId: e.auctionId.value,
      epoch: n(e.epoch.value),
      bidIndex: n(e.bidIndex.value),
      priceMinor: n(e.priceMinor.value),
      bidderAlias: e.bidderAlias.value,
      serverSeq: n(e.serverSeq.value),
      acceptedAtMs: n(e.acceptedAtMs.value),
    }));
  }

  async listResults(): Promise<Result[]> {
    const page = await this.client.select().from(AuctionResult).ownedBy(PUBLISHER).orderBy(desc("closedAtMs")).limit(100).fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      owner: lower(e.$owner),
      auctionId: e.auctionId.value,
      epoch: n(e.epoch.value),
      listingId: e.listingId.value,
      category: e.category.value,
      status: e.status.value as ResultStatus,
      hammerPriceMinor: n(e.hammerPriceMinor.value),
      closedAtMs: n(e.closedAtMs.value),
      winnerAlias: e.winnerAlias.value,
      finalSeq: n(e.finalSeq.value),
      bidCount: n(e.bidCount.value),
      rulesHash: e.rulesHash.value,
      transcriptDigest: e.transcriptDigest.value,
    }));
  }

  async getLatestSnapshot(auctionId: string): Promise<Snapshot | null> {
    const page = await this.client
      .select()
      .from(AuctionSnapshot)
      .ownedBy(PUBLISHER)
      .where(eq("auctionId", str(auctionId)))
      .orderBy(desc("serverSeq"))
      .limit(1)
      .fetch();
    const e = page.entities[0];
    if (!e) return null;
    return {
      key: e.$key,
      owner: lower(e.$owner),
      auctionId: e.auctionId.value,
      serverSeq: n(e.serverSeq.value),
      phase: e.phase.value,
      priceMinor: n(e.priceMinor.value),
      leaderAlias: e.leaderAlias?.value,
      activeCount: n(e.activeCount.value),
      generatedAtMs: n(e.generatedAtMs.value),
    };
  }
}
