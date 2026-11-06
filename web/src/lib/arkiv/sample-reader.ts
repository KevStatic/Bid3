import { buildSampleSet, type SampleSet } from "./sample-data";
import type { ArkivReader, ListingFilter } from "./types";
import { sortListings } from "./sort";

/** Reads the bundled sample set with a small delay, so loading states are exercised. */
export class SampleArkivReader implements ArkivReader {
  readonly mode = "sample" as const;
  private set: Promise<SampleSet> | null = null;

  private data() {
    this.set ??= buildSampleSet();
    return this.set;
  }

  private async delay<T>(value: T): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return value;
  }

  async listListings(filter: ListingFilter = {}) {
    const { listings } = await this.data();
    const rows = listings.filter(
      (l) =>
        (!filter.category || l.category === filter.category) &&
        (!filter.status || l.status === filter.status) &&
        (filter.minStartMinor === undefined || l.startPriceMinor >= filter.minStartMinor) &&
        (filter.maxStartMinor === undefined || l.startPriceMinor <= filter.maxStartMinor),
    );
    return this.delay(sortListings(rows, filter.sort ?? "closing"));
  }

  async getListingByAuction(auctionId: string) {
    const { listings } = await this.data();
    return this.delay(listings.find((l) => l.auctionId === auctionId) ?? null);
  }

  async getDefinition(auctionId: string) {
    const { definitions } = await this.data();
    return this.delay(definitions.find((d) => d.auctionId === auctionId) ?? null);
  }

  async listBids(auctionId: string) {
    const { bids } = await this.data();
    return this.delay(bids.filter((b) => b.auctionId === auctionId).sort((a, b) => b.bidIndex - a.bidIndex));
  }

  async listResults() {
    const { results } = await this.data();
    return this.delay([...results].sort((a, b) => b.closedAtMs - a.closedAtMs));
  }

  async getLatestSnapshot(auctionId: string) {
    const { snapshots } = await this.data();
    return this.delay(snapshots.find((s) => s.auctionId === auctionId) ?? null);
  }
}
