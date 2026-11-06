"""State machine tests: the walkthrough from the plan and every fault case."""

import pytest

from bid3_engine.auction import Auction, Rules

RULES = Rules(start_price_minor=10_000, step_bps=500, countdown_ms=5_000, ceiling_minor=100_000, time_limit_ms=600_000)


def new_auction(**overrides) -> Auction:
    rules = Rules(**{**RULES.__dict__, **overrides})
    a = Auction("bid3-test", "lot-test", rules, [("TAG1", "A1"), ("TAG2", "B2")])
    a.health["bridge"] = "ok"
    a.open(0)
    return a


def test_walkthrough_from_the_plan():
    a = new_auction()
    assert a.phase == "LOBBY"
    a.join(100, "TAG1")
    assert a.phase == "LOBBY"
    assert a.bid(150, "TAG1").ack == "IGNORED"  # one paddle: bidding not open
    a.join(200, "TAG2")
    assert a.phase == "OPEN"

    out = a.bid(1_000, "TAG1")
    assert out.ack == "ACCEPTED" and out.bid["priceMinor"] == 10_000
    assert a.phase == "COUNTDOWN" and a.leader_alias == "A1"
    assert a.countdown["deadlineMs"] == 6_000

    assert a.bid(3_000, "TAG2").bid["priceMinor"] == 10_500  # outbid restarts the call
    assert a.countdown["deadlineMs"] == 8_000
    assert a.bid(3_100, "TAG2").ack == "IGNORED"  # can't outbid yourself
    assert a.bid(4_000, "TAG1").bid["priceMinor"] == 11_025

    a.leave(5_000, "TAG2")  # B2 switches off; A1's bid stands, countdown continues
    assert a.phase == "COUNTDOWN"
    a.join(8_500, "TAG2")
    assert a.bid(8_600, "TAG2").bid["priceMinor"] == 11_576

    a.tick(13_599)
    assert a.phase == "COUNTDOWN"
    out = a.tick(13_600)
    assert a.phase == "SOLD_LOCKED"
    assert a.result == {"winnerAlias": "B2", "hammerPriceMinor": 11_576, "finalSeq": 5}
    assert [k for k, *_ in out.outbox] == ["AuctionResult"]
    result = out.outbox[0][2]
    assert result["transcriptDigest"].startswith("0x") and len(result["transcriptDigest"]) == 66
    assert result["bidCount"] == 4 and result["rulesHash"] == a.rules_hash

    assert a.bid(14_000, "TAG1").ack == "CLOSED"
    assert a.join(14_000, "TAG1").ack == "CLOSED"


def test_leader_switching_off_still_wins():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    a.leave(20, "TAG1")
    a.tick(5_010)
    assert a.phase == "SOLD_LOCKED" and a.result["winnerAlias"] == "A1"


def test_open_falls_back_to_lobby_when_a_paddle_leaves_before_any_bid():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.leave(10, "TAG2")
    assert a.phase == "LOBBY"


def test_switched_off_paddle_cannot_bid():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.leave(10, "TAG2")
    a.join(20, "TAG2")
    a.bid(30, "TAG1")
    a.leave(40, "TAG2")
    out = a.bid(50, "TAG2")
    assert out.ack == "IGNORED" and out.reason == "paddle is switched off"


def test_stale_press_is_refused():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    seen = a.state_version
    a.bid(10, "TAG1")
    out = a.bid(20, "TAG2", state_version=seen)  # B2 pressed before seeing A1's bid
    assert out.ack == "STALE"
    assert a.bid(30, "TAG2", state_version=a.state_version).ack == "ACCEPTED"


def test_unrelated_changes_do_not_make_a_press_stale():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    seen = a.state_version
    a.leave(20, "TAG1")  # a join/leave bumps the version but no bid landed
    assert a.bid(30, "TAG2", state_version=seen).ack == "ACCEPTED"


def test_duplicate_intents_count_once():
    a = new_auction()
    a.join(0, "TAG1", "s1", 1), a.join(0, "TAG2", "s2", 1)
    assert a.bid(10, "TAG1", "s1", 2).ack == "ACCEPTED"
    a.bid(20, "TAG2", "s2", 2)
    out = a.bid(30, "TAG1", "s1", 2)  # transport retry of an old press
    assert out.ack == "IGNORED" and out.reason == "duplicate"
    assert a.bid_count == 2


def test_tag_signal_loss_blocks_only_that_bidder_and_keeps_deadline():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    deadline = dict(a.countdown)
    a.link(1_000, "TAG2", ok=False)
    assert a.phase == "COUNTDOWN" and a.countdown == deadline
    assert a.seat_by_tag("TAG2").status == "UNKNOWN"
    assert a.bid(1_001, "TAG2").ack == "IGNORED"
    a.tick(5_010)
    assert a.phase == "SOLD_LOCKED" and a.result["winnerAlias"] == "A1"


def test_tag_recovery_needs_join_and_does_not_restart_countdown():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    deadline = dict(a.countdown)
    a.link(1_000, "TAG2", ok=False)
    a.link(2_000, "TAG2", ok=True)
    assert a.seat_by_tag("TAG2").status == "UNKNOWN"
    assert a.bid(2_001, "TAG2").ack == "IGNORED"
    assert a.join(2_100, "TAG2").ack == "ACCEPTED"
    assert a.countdown == deadline
    assert a.bid(2_200, "TAG2", state_version=a.state_version).ack == "ACCEPTED"
    assert a.countdown["deadlineMs"] == 7_200


def test_lost_leaders_accepted_bid_stays_binding():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    a.link(1_000, "TAG1", ok=False)
    a.tick(5_010)
    assert a.phase == "SOLD_LOCKED" and a.result["winnerAlias"] == "A1"


def test_other_bidder_can_bid_when_competitor_loses_signal():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.link(1, "TAG1", ok=False)
    assert a.phase == "OPEN"
    assert a.bid(10, "TAG2", state_version=a.state_version).ack == "ACCEPTED"
    a.tick(5_010)
    assert a.result["winnerAlias"] == "B2"


def test_fault_without_accepted_bid_never_fabricates_winner():
    a = new_auction(time_limit_ms=60_000)
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.link(1, "TAG1", ok=False)
    a.tick(5_001)
    assert a.result is None and a.phase == "OPEN"
    a.tick(60_000)
    assert a.phase == "UNSOLD"


def test_bridge_down_pauses_and_paddles_must_reannounce():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    a.set_health(20, "bridge", "down")
    assert a.phase == "PAUSED"
    assert {s.alias: s.status for s in a.seats} == {"A1": "UNKNOWN", "B2": "UNKNOWN"}
    a.set_health(30, "bridge", "ok")
    assert a.can_resume()[0] is False
    a.join(40, "TAG1"), a.join(40, "TAG2")
    assert a.resync(50).changed and a.phase == "COUNTDOWN"


def test_ceiling_stops_bids_and_leader_wins_at_ceiling():
    a = new_auction(ceiling_minor=11_000)
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(1, "TAG1")  # 100.00
    a.bid(2, "TAG2")  # 105.00
    assert a.bid(3, "TAG1").bid["priceMinor"] == 11_000  # capped
    assert a.bid(4, "TAG2").reason == "ceiling reached"
    a.tick(5_003)
    assert a.result["hammerPriceMinor"] == 11_000


def test_time_limit_without_bids_is_unsold():
    a = new_auction(time_limit_ms=60_000)
    a.join(0, "TAG1")
    out = a.tick(60_000)
    assert a.phase == "UNSOLD" and out.outbox[0][2]["status"] == "UNSOLD"


def test_time_limit_excludes_pauses():
    a = new_auction(time_limit_ms=60_000)
    a.join(0, "TAG1")
    a.set_health(30_000, "gateway", "down")  # paused at 30 s of round time
    a.set_health(200_000, "gateway", "ok")
    a.join(200_000, "TAG1")
    assert a.resync(200_000).changed
    a.tick(229_999)
    assert a.phase == "LOBBY"
    a.tick(230_000)
    assert a.phase == "UNSOLD"


def test_cancel_publishes_a_result_and_closes():
    a = new_auction()
    out = a.cancel(5, "Item withdrawn")
    assert a.phase == "CANCELLED" and out.outbox[0][2]["status"] == "CANCELLED"
    assert a.join(6, "TAG1").ack == "CLOSED"


def test_unknown_tag_is_ignored():
    a = new_auction()
    assert a.join(0, "NOPE").ack == "IGNORED"


def test_restart_comes_back_paused_and_restarts_the_countdown():
    a = new_auction()
    a.join(0, "TAG1"), a.join(0, "TAG2")
    a.bid(10, "TAG1")
    restored = Auction.restore(a.dump(), 1_000)
    assert restored.phase == "PAUSED" and restored.price_minor == 10_000
    restored.health["bridge"] = "ok"
    restored.join(2_000, "TAG1"), restored.join(2_000, "TAG2")
    assert restored.resync(2_000).changed
    assert restored.countdown["deadlineMs"] == 7_000


def test_state_matches_the_web_contract():
    a = new_auction()
    state = a.state(123)
    assert set(state) == {
        "auctionId", "epoch", "stateVersion", "phase", "rules", "priceMinor", "nextPriceMinor", "bidCount",
        "leaderAlias", "countdown", "paddles", "health", "arkiv", "result", "pauseReason", "serverTimeMs",
    }
    assert set(state["rules"]) == {"startPriceMinor", "stepBps", "countdownMs", "ceilingMinor", "timeLimitMs", "unit"}
    assert set(state["arkiv"]) == {"lastPublishedSeq", "lastPublishedAtMs", "pending"}


def test_invalid_rules_are_rejected():
    with pytest.raises(ValueError):
        Auction("x", "y", Rules(10_000, 500, 5_000, 9_000, 600_000), [("T1", "A"), ("T2", "B")])
    with pytest.raises(ValueError):
        Auction("x", "y", RULES, [("T1", "A"), ("T1", "B")])
