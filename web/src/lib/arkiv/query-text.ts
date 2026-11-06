import type { ListingFilter } from "./types";

/** The exact SDK query a filter turns into, shown so anyone can rerun it. */
export function listingQueryText(filter: ListingFilter): string {
  const lines = ["client.select().from(ItemListing)"];
  if (filter.category) lines.push(`  .where(eq("category", str("${filter.category}")))`);
  if (filter.status) lines.push(`  .where(eq("status", str("${filter.status}")))`);
  if (filter.minStartMinor !== undefined) lines.push(`  .where(gte("startPriceMinor", u64(${filter.minStartMinor})))`);
  if (filter.maxStartMinor !== undefined) lines.push(`  .where(lte("startPriceMinor", u64(${filter.maxStartMinor})))`);
  lines.push(`  .orderBy(asc("closesAtMs")).limit(100).fetch()`);
  return lines.join("\n");
}
