"""Canonical rules hash. Must match web/src/lib/rules-hash.ts bit for bit.

sha256 over the UTF-8 JSON of these fields, keys in this exact order,
no whitespace, hex-encoded with a 0x prefix.
"""

import hashlib
import json

KEY_ORDER = (
    "auctionId",
    "epoch",
    "listingId",
    "startPriceMinor",
    "stepBps",
    "countdownMs",
    "ceilingMinor",
    "timeLimitMs",
    "unit",
)


def canonical_rules(rules: dict) -> str:
    ordered = {key: rules[key] for key in KEY_ORDER}
    return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def rules_hash(rules: dict) -> str:
    return "0x" + hashlib.sha256(canonical_rules(rules).encode("utf-8")).hexdigest()
