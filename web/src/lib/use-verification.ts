"use client";

import { useQuery } from "@tanstack/react-query";
import { getArkivReader, type Result } from "./arkiv";
import { config } from "./config";
import { formatMinor, percentFromBps } from "./format";
import { priceAtBid } from "./pricing";
import { rulesHash } from "./rules-hash";
import { transcriptDigest } from "./transcript-digest";

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

export interface Verification {
  issuer: Check;
  rules: Check;
  history: Check;
  ladder: Check;
  transcript: Check;
  allOk: boolean;
}

const short = (hex: string) => `${hex.slice(0, 12)}…`;

/**
 * Verifies one result using only Arkiv reads and browser crypto:
 *  1. issuer      the result is owned by the Bid3 publisher wallet
 *  2. rules       sha256 of the published definition matches its rulesHash and the result's
 *  3. history     the bid entities add up to the result (count, final price, winner)
 *  4. ladder      every bid sits at price(bidIndex) from the frozen rules, with no gaps and no
 *                 paddle outbidding itself
 *  5. transcript  sha256 of the bid entities equals the transcriptDigest the result was sealed with
 */
export function useVerification(result: Result) {
  return useQuery({
    queryKey: ["arkiv", "verify", result.key],
    queryFn: async (): Promise<Verification> => {
      const reader = await getArkivReader();
      const [definition, allBids] = await Promise.all([reader.getDefinition(result.auctionId), reader.listBids(result.auctionId)]);
      const bids = allBids.filter((b) => b.epoch === result.epoch).sort((a, b) => a.bidIndex - b.bidIndex);

      const issuerOk = result.owner.toLowerCase() === config.publisherAddress;
      const issuer: Check = {
        ok: issuerOk,
        label: issuerOk ? "Published by Bid3" : "Unverified issuer",
        detail: issuerOk
          ? `Owned by the Bid3 publisher wallet ${config.publisherAddress}.`
          : `Owned by ${result.owner}, not the Bid3 publisher wallet. Anyone can write an entity in this shape; this one isn't ours.`,
      };

      let rules: Check;
      if (!definition) {
        rules = { ok: false, label: "Rules missing", detail: "No AuctionDefinition found for this auction." };
      } else {
        const recomputed = await rulesHash(definition);
        const matchesDefinition = recomputed === definition.rulesHash;
        const matchesResult = definition.rulesHash === result.rulesHash;
        rules = {
          ok: matchesDefinition && matchesResult,
          label: matchesDefinition && matchesResult ? "Rules match" : "Rules don't match",
          detail: matchesDefinition
            ? matchesResult
              ? `Recomputed ${recomputed.slice(0, 18)}… in your browser; it matches the definition and the result.`
              : "The definition is intact, but the result points at different rules."
            : "The published rules don't hash to the rulesHash they claim.",
        };
      }

      let history: Check;
      if (result.status !== "SOLD") {
        // UNSOLD closes with no bids; a CANCELLED round may have had some before it was stopped.
        const ok = bids.length === result.bidCount;
        const none = result.bidCount === 0;
        history = {
          ok,
          label: ok ? (none ? "No bids, as stated" : `${bids.length} bids before it was cancelled`) : "Bids don't add up",
          detail: ok
            ? none
              ? "The result records no bids, and Arkiv holds no bid entities for it."
              : `The result records ${result.bidCount} bids, and Arkiv holds exactly ${bids.length}.`
            : `The result records ${result.bidCount} bids; Arkiv holds ${bids.length}.`,
        };
      } else {
        const top = bids[bids.length - 1];
        const countOk = bids.length === result.bidCount;
        const priceOk = !!top && top.priceMinor === result.hammerPriceMinor && top.bidderAlias === result.winnerAlias;
        history = {
          ok: countOk && priceOk,
          label: countOk && priceOk ? "Bids add up" : "Bids don't add up",
          detail:
            countOk && priceOk
              ? `${bids.length} bid entities; the last one is Paddle ${top.bidderAlias} at the hammer price.`
              : `Result says ${result.bidCount} bids; Arkiv holds ${bids.length}${top ? `, last at ${formatMinor(top.priceMinor)}` : ""}.`,
        };
      }

      let ladder: Check;
      if (!definition) {
        ladder = { ok: false, label: "Ladder unchecked", detail: "Without the published rules there is no ladder to check the bids against." };
      } else if (bids.length === 0) {
        ladder = { ok: true, label: "No bids to price", detail: "There are no bid entities, so no prices to check against the ladder." };
      } else {
        let problem: string | null = null;
        for (let i = 0; i < bids.length && !problem; i++) {
          const bid = bids[i];
          const expected = priceAtBid(definition, i);
          if (bid.bidIndex !== i) problem = `Bid ${i + 1} is missing: the next entity is bid ${bid.bidIndex + 1}.`;
          else if (bid.priceMinor !== expected)
            problem = `Bid ${i + 1} is ${formatMinor(bid.priceMinor)}, but the frozen rules price it at ${formatMinor(expected)}.`;
          else if (i > 0 && bid.bidderAlias === bids[i - 1].bidderAlias) problem = `Paddle ${bid.bidderAlias} outbid itself at bid ${i + 1}.`;
        }
        ladder = {
          ok: !problem,
          label: problem ? "Off the ladder" : "Every bid on the ladder",
          detail:
            problem ??
            `Recomputed all ${bids.length} prices from the frozen rules (${formatMinor(definition.startPriceMinor)}, +${percentFromBps(
              definition.stepBps,
            )} a bid) in your browser. Each bid matches, with no gaps and no paddle outbidding itself.`,
        };
      }

      const recomputedDigest = await transcriptDigest(bids);
      const transcriptOk = recomputedDigest === result.transcriptDigest.toLowerCase();
      const transcript: Check = {
        ok: transcriptOk,
        label: transcriptOk ? "Transcript matches" : "Transcript doesn't match",
        detail: transcriptOk
          ? `Hashed the ${bids.length} bid entities in your browser to ${short(recomputedDigest)}, the digest the result was sealed with.`
          : `The bid entities hash to ${short(recomputedDigest)}, but the result was sealed with ${short(result.transcriptDigest)}. A bid was added, removed or changed.`,
      };

      return {
        issuer,
        rules,
        history,
        ladder,
        transcript,
        allOk: issuer.ok && rules.ok && history.ok && ladder.ok && transcript.ok,
      };
    },
  });
}
