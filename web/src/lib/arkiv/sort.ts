import type { Listing, ListingSort } from "./types";

const STATUS_ORDER: Record<Listing["status"], number> = { OPEN: 0, UPCOMING: 1, CLOSED: 2 };

export function sortListings(rows: Listing[], sort: ListingSort): Listing[] {
  const copy = [...rows];
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => a.startPriceMinor - b.startPriceMinor);
    case "price-desc":
      return copy.sort((a, b) => b.startPriceMinor - a.startPriceMinor);
    case "lot":
      return copy.sort((a, b) => a.lotNumber - b.lotNumber);
    case "closing":
    default:
      return copy.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.closesAtMs - b.closesAtMs);
  }
}
