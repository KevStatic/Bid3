# Bid3 bidding rules and edge cases

Final user decision incorporated: **10-second inactivity hammer; accepted bids remain binding after switch OFF.** This replaces the earlier automatic rising-price/dropout model. The price changes only for an accepted button bid.

## Opening and price

1. Freeze the auction ID, epoch, eligible seats, unit, opening price, percentage increment, ceiling, 10,000 ms hammer interval and admission time limit before opening. Changing a rule requires a new epoch and rules hash. A seller cannot retract an inconvenient accepted price.
2. An enrolled tag controls one eligible seat, not proof of one unique human. Use unpredictable per-round aliases on the website and Arkiv. Keep device enrollment and raw signed radio frames private.
3. ON requests JOIN. The tag becomes ACTIVE only after engine acceptance. Two verified ACTIVE seats are required to reach OPEN at least once. A lone tag cannot automatically win an unbid lot.
4. The first accepted bid is bidIndex 0 at the opening price. Each following accepted bid advances one rung. Compute directly from the opening price using exact integers:

   `min(ceiling, round_half_up(startMinor * (10000+stepBps)^bidIndex / 10000^bidIndex))`.

   Never repeatedly compound the rounded displayed amount. Example at 5%: 100.00, 105.00, 110.25, 115.76. Example values are not approval of a financial unit or settlement policy.
5. One stable press creates one intent. Holding the button creates one bid. Release must debounce before another bid. An accepted leader cannot outbid themselves.

## Two people press together

Each intent signs the auction/epoch/rules, tag boot/session, unique event sequence, **quote version and exact next price captured at the initial button edge**.

The engine serializes verified inputs in one authoritative ingestion order. Both seats may bid the same quote. The first valid input is accepted and advances that quote version. The second is **STALE**, reports refusal through gateway/engine feedback, and does not bid the higher price. The bidder must release and press again after receiving the new quote.

There is no reliable universal notion of the same physical instant across independent radios. Do not compare tag uptime clocks or RSSI to choose a winner. Publish the actual policy as **first valid request in engine order**, not a claim about who physically moved first. The gateway FIFO does not intentionally prioritize Tag 01. Signature completion, transport arrival and engine admission are measurable stages. Invalid traffic is bounded/dropped; it must not consume another seat's valid identity or nonce.

Only the engine may decide acceptance. Gateway verification means the request is authentic, not that the bid won ordering. No artificial tie-collection window or random tie-break is added.

## Ten-second hammer

- Each accepted BID makes that seat the leader and sets a fresh deadline to engine monotonic time + **10,000 ms**. Increment countdown generation.
- A later accepted bid before that deadline restarts the full ten seconds. Refused bids, duplicate transmissions, joins, leaves and cosmetic feedback do not restart it.
- At exact deadline equality, closure precedes a new bid. A bid admitted in authoritative engine order strictly before deadline is processed before closure; a later one is CLOSED. Do not backdate a bid from a tag timestamp or an unverified ingress timestamp.
- On expiry, lock exactly one result for the latest accepted bidder at its accepted price. The engine must first check fresh critical health, competition history, current generation, eligible leader and all earlier admitted inputs; then commit result/outbox atomically. The gateway shows that confirmed result and plays the sale pattern.
- No accepted bid means no leader and no 10-second sale. The no-bid round can close UNSOLD at its published time limit.
- New admission stops at the round time limit. A bid accepted before that cutoff receives its full ten-second hammer interval, even if the interval extends past the cutoff. Publish this policy with the rules; do not truncate an accepted bidder's last interval.
- A closed epoch cannot be reopened by a button, switch, delayed message or publication retry. A new round is explicit.

## OFF, re-entry and signal loss

OFF sends a signed LEAVE and prevents new bids. **It does not cancel an accepted bid.** The last accepted bidder can win after switching OFF. Even if both seats deliberately leave, the last accepted bid remains binding and its healthy countdown continues. Do not transfer a bid to another present tag or choose a tag merely because it was seen most recently.

A nonleader can rejoin before closure and submit a new bid. Rejoining alone does not reset the hammer. Leaving OPEN before the first bid returns to LOBBY if fewer than two seats remain; two active seats must be restored before accepting the opening bid.

Radio silence, a battery failure, an unacknowledged LEAVE, gateway/USB/engine loss or queue overflow is uncertainty, not a withdrawal. Pause bid acceptance and the hammer. The auction-mode OFF setting keeps the BLE session alive so deliberate withdrawal does not look like a power failure. A lost connection requires fresh resynchronization; if a leader exists, restart a full ten seconds with a new generation. Keep its accepted price and binding bid. Do not allow old queued presses to enter as fresh bids after recovery.

Fresh JOIN/LEAVE requests may establish seat state while PAUSED; they cannot unpause the clock. Only an explicit engine recovery with verified health may resume bidding. A paused room must have an operational recovery/cancellation policy rather than remaining frozen indefinitely.

## Refusals and reliability

Reasons: STALE, LEADING, NOT_ACTIVE, NOT_OPEN, CLOSED, CEILING, UNHEALTHY, INVALID. A price at the ceiling cannot advance again; the accepted leader keeps its hammer. A duplicate exact event receives its original decision and never increments price or restarts the deadline. Reusing an event ID with different contents is invalid.

Bind enrollment, current gateway/bridge authentication, auction/epoch/rules, current session and freshness before verifying admission. Persist the event identity and result transactionally before ACK. Keep rejected attempts and operational pauses in a private audit journal. Per-tag sequence exhaustion or lost queue contents closes the session and requires recovery, never counter wrap or fabricated bids.

## Arkiv and settlement

Arkiv is the public record layer: seller listing, frozen definition, one record for every accepted bid, coalesced room snapshots and final result. The engine durably queues publications and retries/reconciles with stable logical IDs. Do not wait for a transaction confirmation to acknowledge a radio bid. Distinguish accepted engine state, pending publication and confirmed Arkiv reads.

Match the team's schema and publisher ownership checks. Update `countdownMs` to 10000 in the web/seller/simulator/engine and recompute rules hashes. Public snapshots are checkpoints, not subsecond consensus. Arkiv publication verifies what an issuer published; it alone does not prove fair server timing, guarantee permanent history or settle payment. Payment and physical delivery need an explicit separate process. This firmware does not implement escrow or an Arkiv publisher.

V2 tag indicator: a steady LED means the physical switch is ON, not that a join/bid was accepted. Do not infer auction status from it.
