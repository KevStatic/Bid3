"""The engine's maths must match the browser's exactly. Vectors come from web/src/lib/*.ts
(regenerate with: node --experimental-strip-types engine/scripts/make_vectors.mjs)."""

import json
from pathlib import Path

from bid3_engine.auction import canonical_transcript, transcript_digest
from bid3_engine.pricing import price_at_bid
from bid3_engine.rules_hash import canonical_rules, rules_hash

VECTORS = json.loads((Path(__file__).parent / "vectors.json").read_text())


def test_pricing_matches_typescript():
    for ladder in VECTORS["pricing"]:
        for index, expected in enumerate(ladder["prices"]):
            got = price_at_bid(ladder["startPriceMinor"], ladder["stepBps"], ladder["ceilingMinor"], index)
            assert got == expected, (ladder["startPriceMinor"], ladder["stepBps"], index)


def test_rules_hash_matches_typescript():
    for case in VECTORS["hashes"]:
        assert canonical_rules(case["rules"]) == case["canonical"]
        assert rules_hash(case["rules"]) == case["hash"]


def test_transcript_digest_matches_typescript():
    # The results explorer recomputes this in the browser from the AuctionBid entities.
    assert len(VECTORS["transcripts"]) >= 3
    for case in VECTORS["transcripts"]:
        assert canonical_transcript(case["bids"]) == case["canonical"]
        assert transcript_digest(case["bids"]) == case["digest"]


def test_plan_examples():
    ladder = [price_at_bid(10_000, 500, 100_000, i) for i in range(5)]
    assert ladder == [10_000, 10_500, 11_025, 11_576, 12_155]
    assert price_at_bid(10_000, 500, 100_000, 200) == 100_000
