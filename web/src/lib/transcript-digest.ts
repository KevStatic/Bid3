/**
 * Transcript digest: sha256 over the accepted bids, oldest first, as compact JSON with sorted keys.
 *
 * Must match engine/bid3_engine/auction.py `transcript_digest()` byte for byte. The engine uses
 * Python's json.dumps(..., separators=(",", ":"), sort_keys=True), which escapes every character
 * outside printable ASCII as \uXXXX (ensure_ascii), so this does the same. Drift check:
 * engine/tests/test_vectors.py, with vectors generated from this file by engine/scripts/make_vectors.mjs.
 */
export interface TranscriptBid {
  bidIndex: number;
  bidderAlias: string;
  priceMinor: number;
  serverSeq: number;
}

export function canonicalTranscript(bids: TranscriptBid[]): string {
  const ordered = [...bids].sort((a, b) => a.bidIndex - b.bidIndex);
  // Keys listed in sorted order, as Python's sort_keys=True writes them.
  const json = JSON.stringify(
    ordered.map((b) => ({ bidIndex: b.bidIndex, bidderAlias: b.bidderAlias, priceMinor: b.priceMinor, serverSeq: b.serverSeq })),
  );
  return json.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export async function transcriptDigest(bids: TranscriptBid[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalTranscript(bids));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "0x" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
