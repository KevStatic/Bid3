/** View models for Arkiv entities, independent of the SDK's value wrappers. */

export interface EntityMeta {
  /** Arkiv entity key. */
  key: string;
  /** Wallet that owns the entity. */
  owner: string;
}

export type ListingStatus = "UPCOMING" | "OPEN" | "CLOSED";
export type ResultStatus = "SOLD" | "UNSOLD" | "CANCELLED";

export interface Listing extends EntityMeta {
  listingId: string;
  lotNumber: number;
  category: string;
  status: ListingStatus;
  startPriceMinor: number;
  closesAtMs: number;
  auctionId: string;
  sellerAlias: string;
  sellerAddress: string;
  title: string;
  description: string;
  condition: string;
  imageUrl?: string;
}

export interface Definition extends EntityMeta {
  auctionId: string;
  epoch: number;
  listingId: string;
  rulesHash: string;
  startPriceMinor: number;
  stepBps: number;
  countdownMs: number;
  ceilingMinor: number;
  timeLimitMs: number;
  unit: string;
}

export interface BidRecord extends EntityMeta {
  auctionId: string;
  epoch: number;
  bidIndex: number;
  priceMinor: number;
  bidderAlias: string;
  serverSeq: number;
  acceptedAtMs: number;
}

export interface Snapshot extends EntityMeta {
  auctionId: string;
  serverSeq: number;
  phase: string;
  priceMinor: number;
  leaderAlias?: string;
  activeCount: number;
  generatedAtMs: number;
}

export interface Result extends EntityMeta {
  auctionId: string;
  epoch: number;
  listingId: string;
  category: string;
  status: ResultStatus;
  hammerPriceMinor: number;
  closedAtMs: number;
  winnerAlias: string;
  finalSeq: number;
  bidCount: number;
  rulesHash: string;
  transcriptDigest: string;
}

export type ListingSort = "closing" | "price-asc" | "price-desc" | "lot";

export interface ListingFilter {
  category?: string;
  status?: ListingStatus;
  minStartMinor?: number;
  maxStartMinor?: number;
  sort?: ListingSort;
}

export interface ArkivReader {
  readonly mode: "sample" | "live";
  listListings(filter?: ListingFilter): Promise<Listing[]>;
  getListingByAuction(auctionId: string): Promise<Listing | null>;
  getDefinition(auctionId: string): Promise<Definition | null>;
  listBids(auctionId: string): Promise<BidRecord[]>;
  listResults(): Promise<Result[]>;
  getLatestSnapshot(auctionId: string): Promise<Snapshot | null>;
}
