# Bid3 bidding rules

These rules apply to the existing authoritative engine with this firmware/bridge and countdownMs=10000. The gateway authenticates inputs; the engine orders bids, computes prices and locks results.

| Situation | Required result |
|---|---|
| Switch ON | Signed JOIN requests participation. A bidder can bid after accepted admission and an OPEN/COUNTDOWN state. |
| Fewer than two active bidders before bidding begins | LOBBY; no price bid is accepted. |
| Valid button press | One BID for the next published price, against the stateVersion captured at the button edge. |
| Button held / switch bounce | Debounced; no repeated bids from one held press. |
| Two people press at the same time | Their clocks cannot establish a trustworthy global physical order. The engine serializes valid arrivals. First valid same-version bid is accepted; the other is STALE. |
| Different quote versions | Each is checked against the engine's current state. A newer valid quote can be accepted; no bid is silently repriced. |
| Leading bidder presses again | Refused as LEADING; it does not restart the timer. |
| Duplicate radio delivery | Same session/sequence and exact packet is acknowledged again; it is not forwarded as a new bid. |
| Press before admission, in LOBBY, paused or without a current engine quote | Shows an authenticated BUTTON PRESSED / INPUT RECEIVED diagnostic; it cannot become an accepted price bid. |
| New bid accepted | Leader/price update; full 10,000 ms countdown restarts from engine acceptance. |
| Rejected/invalid press | No price increase and no countdown restart. |
| No accepted bid for ten seconds after the latest accepted bid | If the engine remains healthy and competition occurred, lock SOLD to the current accepted leader. |
| No bid has ever been accepted | There is no latest bidder to award. The round remains open/lobby until its rules' time limit, then UNSOLD. |
| Leader intentionally switches OFF | Signed LEAVE stops further participation; their accepted leading bid remains binding and can still win. |
| A different tag is merely nearby/latest present | It never replaces the accepted leader automatically. |
| Tag disconnects / radio heartbeat missing | Gateway reports LINK LOST; an active seat becomes UNKNOWN and the engine pauses. Silence is not a signed LEAVE. |
| Bridge/gateway/engine connection fails | Pause and refuse stale work. Do not declare a local winner while the engine is unavailable. |
| Recovery | Re-authenticate/re-announce, satisfy engine health conditions, then resume according to engine policy. A running countdown restarts in full after resync. |
| Press arrives at the hammer boundary | Engine clock/order governs; late arrivals cannot reopen a locked result. A tag uptime is diagnostic, not an authority to backdate a bid. |
| Price ceiling reached | Refuse further raises; current leader can win at expiry. |
| Power loss / restart | Existing keys persist in NVS. Reconnection establishes fresh session context. An unacknowledged press is uncertain and is not silently replayed as a later, higher bid. Consult the engine journal. |
| New lot | Drain pending events before changing the engine's active auction; the v1 signature lacks a round identifier. Rejoin for the next lot. |
| Arkiv publication delayed | The engine journal/outbox retains the decision; publication retries never select a new winner or block the live timer. |

The price ladder is the existing engine's integer minor-unit calculation from the opening price and bid index, using the published basis-point step. It is not recomputed from rounded display text. A typical 500-bps ladder is 100.00, 105.00, 110.25, 115.76.

LEDs and sound acknowledge the engine's result. They cannot prove exact physical simultaneity, eliminate RF contention or make internet latency zero. The bidder must see the offered price on the room frontend; this firmware keeps the existing OLED layout and does not replace that display of terms.
