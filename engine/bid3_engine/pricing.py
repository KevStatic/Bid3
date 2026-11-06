"""Exact bid ladder. Must match web/src/lib/pricing.ts bit for bit.

    price(n) = min(ceiling, round_half_up(start * (10000 + step_bps)^n / 10000^n))

Always computed from the start price and the bid index, never by compounding
the previous price, so there is no rounding drift. Money is integer minor units.
"""

BPS = 10_000


def price_at_bid(start_price_minor: int, step_bps: int, ceiling_minor: int, bid_index: int) -> int:
    if bid_index < 0:
        raise ValueError("bid_index must be non-negative")
    numerator = start_price_minor * (BPS + step_bps) ** bid_index
    denominator = BPS**bid_index
    quotient, remainder = divmod(numerator, denominator)
    if remainder * 2 >= denominator:
        quotient += 1
    return min(quotient, ceiling_minor)
