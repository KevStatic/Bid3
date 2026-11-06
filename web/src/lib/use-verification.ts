"use client";

import { useQuery } from "@tanstack/react-query";
import { getArkivReader, type Result } from "./arkiv";
import { config } from "./config";
import { rulesHash } from "./rules-hash";

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

export interface Verification {
  issuer: Check;
  rules: Check;
  history: Check;
  allOk: boolean;
}

/**
 * Verifies one result using only Arkiv reads and browser crypto:
 *  1. issuer   the result is owned by the Bid3 publisher wallet
 *  2. rules    sha256 of the published definition matches its rulesHash and the result's
 *  3. history  the bid entities add up to the result (count and final price)
 */
export function useVerification(result: Result) {
  return useQuery({
    queryKey: ["arkiv", "verify", result.key],
    queryFn: async (): Promise<Verification> => {
      const reader = await getArkivReader();
      const [definition, bids] = await Promise.all([reader.getDefinition(result.auctionId), reader.listBids(result.auctionId)]);

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
        const ok = bids.length === 0;
        history = {
          ok,
          label: ok ? "No bids, as stated" : "Bids found on an unsold lot",
          detail: ok ? "An unsold result has no bid entities." : `${bids.length} bid entities exist for a lot marked unsold.`,
        };
      } else {
        const top = bids.reduce((max, b) => (b.bidIndex > max.bidIndex ? b : max), bids[0]);
        const countOk = bids.length === result.bidCount;
        const priceOk = !!top && top.priceMinor === result.hammerPriceMinor && top.bidderAlias === result.winnerAlias;
        history = {
          ok: countOk && priceOk,
          label: countOk && priceOk ? "Bids add up" : "Bids don't add up",
          detail:
            countOk && priceOk
              ? `${bids.length} bid entities; the last one is Paddle ${top.bidderAlias} at the hammer price.`
              : `Result says ${result.bidCount} bids; Arkiv holds ${bids.length}${top ? `, last at ${top.priceMinor / 100}` : ""}.`,
        };
      }

      return { issuer, rules, history, allOk: issuer.ok && rules.ok && history.ok };
    },
  });
}
