"""The Bid3 auction state machine.

Pure and deterministic: no I/O, no clock of its own. Every method takes
`now_ms`, so the same inputs always produce the same state, prices and winner.
The runtime (runtime.py) serializes calls, persists state and broadcasts it.

Rules (see the plan, section 3):
  - Switch ON joins, OFF leaves; eligibility persists across OFF/ON.
  - Bidding opens once two paddles are on. The first BID bids the start price.
  - Each accepted BID bids price(bidCount), makes the presser the leader and
    restarts the hammer countdown. The leader cannot outbid themselves.
  - A press carrying an out-of-date stateVersion (a bid landed since) is STALE.
  - The leader switching off keeps their bid binding.
  - A paddle-specific fault blocks that paddle; other bidders and the countdown continue.
    Bridge/gateway failure pauses the whole round.
  - When the countdown ends with a leader and everything healthy: SOLD, once.

Serialized state matches web/src/lib/types.ts (AuctionState) exactly.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

from .pricing import price_at_bid
from .rules_hash import rules_hash

Phase = Literal["DRAFT", "LOBBY", "OPEN", "COUNTDOWN", "PAUSED", "SOLD_LOCKED", "UNSOLD", "CANCELLED"]
PaddleStatus = Literal["OUT", "JOIN_PENDING", "ACTIVE", "LEAVE_PENDING", "UNKNOWN"]
AckResult = Literal["ACCEPTED", "STALE", "IGNORED", "CLOSED"]

CLOSED_PHASES = ("SOLD_LOCKED", "UNSOLD", "CANCELLED")
BIDDING_PHASES = ("OPEN", "COUNTDOWN")


@dataclass(frozen=True)
class Rules:
    start_price_minor: int
    step_bps: int
    countdown_ms: int
    ceiling_minor: int
    time_limit_ms: int
    unit: str = "demo credits"

    def validate(self) -> None:
        if self.start_price_minor <= 0:
            raise ValueError("startPriceMinor must be positive")
        if self.ceiling_minor <= self.start_price_minor:
            raise ValueError("ceilingMinor must be above startPriceMinor")
        if not 0 < self.step_bps <= 10_000:
            raise ValueError("stepBps must be between 1 and 10000")
        if not 1_000 <= self.countdown_ms <= 60_000:
            raise ValueError("countdownMs must be between 1000 and 60000")
        if self.time_limit_ms < 60_000:
            raise ValueError("timeLimitMs must be at least 60000")

    def to_json(self) -> dict[str, Any]:
        return {
            "startPriceMinor": self.start_price_minor,
            "stepBps": self.step_bps,
            "countdownMs": self.countdown_ms,
            "ceilingMinor": self.ceiling_minor,
            "timeLimitMs": self.time_limit_ms,
            "unit": self.unit,
        }

    @staticmethod
    def from_json(data: dict[str, Any]) -> "Rules":
        return Rules(
            start_price_minor=int(data["startPriceMinor"]),
            step_bps=int(data["stepBps"]),
            countdown_ms=int(data["countdownMs"]),
            ceiling_minor=int(data["ceilingMinor"]),
            time_limit_ms=int(data["timeLimitMs"]),
            unit=str(data.get("unit", "demo credits")),
        )


@dataclass
class Seat:
    tag_ref: str
    alias: str
    status: PaddleStatus = "OUT"


@dataclass
class Outcome:
    """What one input did, for the runtime: acks, new bids and outbox records."""

    changed: bool = False
    ack: AckResult | None = None
    reason: str | None = None
    bid: dict[str, Any] | None = None
    outbox: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)  # (kind, logicalId, payload)
    journal: list[tuple[str, dict[str, Any]]] = field(default_factory=list)  # (kind, payload)


class Auction:
    def __init__(
        self,
        auction_id: str,
        listing_id: str,
        rules: Rules,
        seats: list[tuple[str, str]],
        epoch: int = 1,
        category: str = "Other",
    ):
        rules.validate()
        aliases = [alias for _, alias in seats]
        tags = [tag for tag, _ in seats]
        if len(set(aliases)) != len(aliases) or len(set(tags)) != len(tags):
            raise ValueError("seat aliases and tag refs must be unique")
        if len(seats) < 2:
            raise ValueError("an auction needs at least two seats")

        self.auction_id = auction_id
        self.listing_id = listing_id
        self.category = category
        self.rules = rules
        self.epoch = epoch
        self.seats: list[Seat] = [Seat(tag_ref=t, alias=a) for t, a in seats]

        self.phase: Phase = "DRAFT"
        self.state_version = 1
        self.server_seq = 0
        self.bid_count = 0
        self.price_minor = rules.start_price_minor
        self.leader_alias: str | None = None
        self.countdown: dict[str, int] | None = None
        self.countdown_generation = 0
        self.had_competition = False
        self.bids: list[dict[str, Any]] = []  # newest first
        self.last_bid_state_version = 0
        self.result: dict[str, Any] | None = None
        self.pause_reason: str | None = None
        self.paused_from: Phase | None = None
        self.health = {"gateway": "ok", "bridge": "down", "engine": "ok"}
        self.arkiv = {"lastPublishedSeq": None, "lastPublishedAtMs": None, "pending": 0}
        self.rules_hash: str | None = None
        self.seen_intents: set[tuple[str, str, int]] = set()
        # Round time excludes pauses: accumulate only while bidding is live.
        self.round_elapsed_ms = 0
        self.round_clock_from: int | None = None
        self.last_now_ms = 0

    # ------------------------------------------------------------- helpers

    def seat_by_tag(self, tag_ref: str) -> Seat | None:
        return next((s for s in self.seats if s.tag_ref == tag_ref), None)

    def seat_by_alias(self, alias: str) -> Seat | None:
        return next((s for s in self.seats if s.alias == alias), None)

    def active_count(self) -> int:
        return sum(1 for s in self.seats if s.status == "ACTIVE")

    @property
    def next_price_minor(self) -> int:
        return price_at_bid(self.rules.start_price_minor, self.rules.step_bps, self.rules.ceiling_minor, self.bid_count)

    def is_closed(self) -> bool:
        return self.phase in CLOSED_PHASES

    def _bump(self, now_ms: int) -> None:
        self.state_version += 1
        self.last_now_ms = now_ms

    def _seq(self) -> int:
        self.server_seq += 1
        return self.server_seq

    def _start_round_clock(self, now_ms: int) -> None:
        if self.round_clock_from is None:
            self.round_clock_from = now_ms

    def _stop_round_clock(self, now_ms: int) -> None:
        if self.round_clock_from is not None:
            self.round_elapsed_ms += max(0, now_ms - self.round_clock_from)
            self.round_clock_from = None

    def round_elapsed(self, now_ms: int) -> int:
        running = (now_ms - self.round_clock_from) if self.round_clock_from is not None else 0
        return self.round_elapsed_ms + max(0, running)

    def definition_payload(self) -> dict[str, Any]:
        return {
            "auctionId": self.auction_id,
            "epoch": self.epoch,
            "listingId": self.listing_id,
            "rulesHash": self.rules_hash,
            **{k: v for k, v in self.rules.to_json().items()},
        }

    # ------------------------------------------------------------- control

    def open(self, now_ms: int) -> Outcome:
        """Freeze the rules and let paddles join."""
        out = Outcome()
        if self.phase != "DRAFT":
            out.reason = f"cannot open from {self.phase}"
            return out
        hashable = {"auctionId": self.auction_id, "epoch": self.epoch, "listingId": self.listing_id, **self.rules.to_json()}
        self.rules_hash = rules_hash(hashable)
        self.phase = "LOBBY"
        self._start_round_clock(now_ms)
        self._bump(now_ms)
        out.changed = True
        out.outbox.append(("AuctionDefinition", f"definition:{self.auction_id}:{self.epoch}", self.definition_payload()))
        out.journal.append(("OPENED", {"rulesHash": self.rules_hash}))
        return out

    def cancel(self, now_ms: int, reason: str) -> Outcome:
        out = Outcome()
        if self.is_closed():
            out.reason = "already closed"
            return out
        self.phase = "CANCELLED"
        self.countdown = None
        self._stop_round_clock(now_ms)
        self._bump(now_ms)
        out.changed = True
        out.journal.append(("CANCELLED", {"reason": reason}))
        out.outbox.append(self._result_record("CANCELLED", now_ms))
        return out

    def pause(self, now_ms: int, reason: str) -> Outcome:
        out = Outcome()
        if self.is_closed() or self.phase in ("DRAFT", "PAUSED"):
            if self.phase == "PAUSED" and reason != self.pause_reason:
                self.pause_reason = reason
                self._bump(now_ms)
                out.changed = True
            return out
        self.paused_from = self.phase
        self.phase = "PAUSED"
        self.pause_reason = reason
        self.countdown = None  # restarted in full after resync
        self._stop_round_clock(now_ms)
        self._bump(now_ms)
        out.changed = True
        out.journal.append(("PAUSED", {"reason": reason}))
        return out

    def can_resume(self) -> tuple[bool, str | None]:
        if self.phase != "PAUSED":
            return False, "not paused"
        if self.health["bridge"] != "ok" or self.health["gateway"] != "ok":
            return False, "gateway or bridge still down"
        if any(s.status == "UNKNOWN" for s in self.seats):
            return False, "a paddle's signal is still lost"
        return True, None

    def resync(self, now_ms: int) -> Outcome:
        """Leave PAUSED once everything is healthy. A running countdown restarts in full."""
        out = Outcome()
        ok, why = self.can_resume()
        if not ok:
            out.reason = why
            return out
        if self.leader_alias is not None:
            self.phase = "COUNTDOWN"
            self._restart_countdown(now_ms)
        elif self.active_count() >= 2:
            self.phase = "OPEN"
        else:
            self.phase = "LOBBY"
        self.pause_reason = None
        self.paused_from = None
        self._start_round_clock(now_ms)
        self._bump(now_ms)
        out.changed = True
        out.journal.append(("RESUMED", {"phase": self.phase}))
        return out

    def set_health(self, now_ms: int, part: str, value: str) -> Outcome:
        out = Outcome()
        if part not in ("gateway", "bridge", "engine") or self.health.get(part) == value:
            return out
        self.health[part] = value
        if value == "down" and part in ("bridge", "gateway"):
            # Nobody can vouch for the paddles any more: each must re-announce (JOIN or LINK OK) before the room resumes.
            for seat in self.seats:
                if seat.status == "ACTIVE":
                    seat.status = "UNKNOWN"
        self._bump(now_ms)
        out.changed = True
        if value != "ok" and self.phase in ("LOBBY", "OPEN", "COUNTDOWN"):
            paused = self.pause(now_ms, f"The {part} is {'down' if value == 'down' else 'slow'}. Bidding is paused.")
            out.journal.extend(paused.journal)
        return out

    # ------------------------------------------------------------- paddles

    def _dedupe(self, tag_ref: str, session: str | None, seq: int | None) -> bool:
        """True if this exact intent was already processed (transport retry)."""
        if session is None or seq is None:
            return False
        key = (tag_ref, session, seq)
        if key in self.seen_intents:
            return True
        self.seen_intents.add(key)
        return False

    def join(self, now_ms: int, tag_ref: str, session: str | None = None, seq: int | None = None) -> Outcome:
        out = Outcome()
        seat = self.seat_by_tag(tag_ref)
        if seat is None:
            out.ack, out.reason = "IGNORED", "unknown tag"
            return out
        if self._dedupe(tag_ref, session, seq):
            out.ack, out.reason = "IGNORED", "duplicate"
            return out
        if self.is_closed() or self.phase == "DRAFT":
            out.ack, out.reason = "CLOSED", f"auction is {self.phase}"
            return out
        if seat.status == "ACTIVE":
            out.ack = "ACCEPTED"
            return out
        was_unknown = seat.status == "UNKNOWN"
        seat.status = "ACTIVE"
        if self.active_count() >= 2:
            self.had_competition = True
        if self.phase == "LOBBY" and self.active_count() >= 2:
            self.phase = "OPEN"
        self._bump(now_ms)
        out.changed, out.ack = True, "ACCEPTED"
        out.journal.append(("JOIN", {"alias": seat.alias, "afterSignalLoss": was_unknown}))
        return out

    def leave(self, now_ms: int, tag_ref: str, session: str | None = None, seq: int | None = None) -> Outcome:
        out = Outcome()
        seat = self.seat_by_tag(tag_ref)
        if seat is None:
            out.ack, out.reason = "IGNORED", "unknown tag"
            return out
        if self._dedupe(tag_ref, session, seq):
            out.ack, out.reason = "IGNORED", "duplicate"
            return out
        if self.is_closed():
            out.ack, out.reason = "CLOSED", f"auction is {self.phase}"
            return out
        if seat.status == "OUT":
            out.ack = "ACCEPTED"
            return out
        seat.status = "OUT"
        # A leading bid stays binding; only an open round with no bids falls back to the lobby.
        if self.phase == "OPEN" and self.active_count() < 2:
            self.phase = "LOBBY"
        self._bump(now_ms)
        out.changed, out.ack = True, "ACCEPTED"
        out.journal.append(("LEAVE", {"alias": seat.alias}))
        return out

    def link(self, now_ms: int, tag_ref: str, ok: bool) -> Outcome:
        """A tag fault isolates that bidder. Recovery requires a fresh admitted JOIN."""
        out = Outcome()
        seat = self.seat_by_tag(tag_ref)
        if seat is None or self.is_closed():
            return out
        if not ok and seat.status == "ACTIVE":
            seat.status = "UNKNOWN"
            self._bump(now_ms)
            out.changed = True
            out.journal.append(("SIGNAL_LOST", {"alias": seat.alias}))
        elif ok and seat.status == "UNKNOWN":
            # Radio presence is not admission; the signed JOIN completes recovery.
            out.journal.append(("SIGNAL_BACK", {"alias": seat.alias, "requiresJoin": True}))
        return out

    def bid(self, now_ms: int, tag_ref: str, session: str | None = None, seq: int | None = None, state_version: int | None = None) -> Outcome:
        out = Outcome()
        seat = self.seat_by_tag(tag_ref)
        if seat is None:
            out.ack, out.reason = "IGNORED", "unknown tag"
            return out
        if self._dedupe(tag_ref, session, seq):
            out.ack, out.reason = "IGNORED", "duplicate"
            return out
        if self.is_closed():
            out.ack, out.reason = "CLOSED", f"auction is {self.phase}"
            out.journal.append(("BID_REFUSED", {"alias": seat.alias, "reason": out.reason}))
            return out
        if self.phase not in BIDDING_PHASES:
            out.ack, out.reason = "IGNORED", "bidding opens when two paddles are on" if self.phase == "LOBBY" else f"auction is {self.phase}"
            out.journal.append(("BID_REFUSED", {"alias": seat.alias, "reason": out.reason}))
            return out
        if seat.status != "ACTIVE":
            out.ack, out.reason = "IGNORED", "paddle signal is lost" if seat.status == "UNKNOWN" else "paddle is switched off"
            out.journal.append(("BID_REFUSED", {"alias": seat.alias, "reason": out.reason}))
            return out
        if self.leader_alias == seat.alias:
            out.ack, out.reason = "IGNORED", "already leading"
            return out
        if state_version is not None and state_version < self.last_bid_state_version:
            out.ack, out.reason = "STALE", "another bid landed first"
            out.journal.append(("BID_REFUSED", {"alias": seat.alias, "reason": out.reason}))
            return out
        if self.bid_count > 0 and self.price_minor >= self.rules.ceiling_minor:
            out.ack, out.reason = "IGNORED", "ceiling reached"
            out.journal.append(("BID_REFUSED", {"alias": seat.alias, "reason": out.reason}))
            return out

        price = self.next_price_minor
        bid = {
            "serverSeq": self._seq(),
            "bidIndex": self.bid_count,
            "priceMinor": price,
            "bidderAlias": seat.alias,
            "acceptedAtMs": now_ms,
        }
        self.bids.insert(0, bid)
        self.bid_count += 1
        self.price_minor = price
        self.leader_alias = seat.alias
        self.phase = "COUNTDOWN"
        self._restart_countdown(now_ms)
        self._bump(now_ms)
        self.last_bid_state_version = self.state_version

        out.changed, out.ack, out.bid = True, "ACCEPTED", bid
        out.journal.append(("BID", bid))
        out.outbox.append(
            (
                "AuctionBid",
                f"bid:{self.auction_id}:{self.epoch}:{bid['bidIndex']}",
                {"auctionId": self.auction_id, "epoch": self.epoch, **bid},
            )
        )
        return out

    def _restart_countdown(self, now_ms: int) -> None:
        self.countdown_generation += 1
        self.countdown = {
            "deadlineMs": now_ms + self.rules.countdown_ms,
            "durationMs": self.rules.countdown_ms,
            "generation": self.countdown_generation,
        }

    # ------------------------------------------------------------- time

    def tick(self, now_ms: int) -> Outcome:
        out = Outcome()
        if self.phase == "COUNTDOWN" and self.countdown and now_ms >= self.countdown["deadlineMs"]:
            ok, why = self._closing_checks()
            if ok:
                self.phase = "SOLD_LOCKED"
                self.result = {
                    "winnerAlias": self.leader_alias,
                    "hammerPriceMinor": self.price_minor,
                    "finalSeq": self._seq(),
                }
                self.countdown = None
                self._stop_round_clock(now_ms)
                self._bump(now_ms)
                out.changed = True
                out.journal.append(("SOLD", dict(self.result)))
                out.outbox.append(self._result_record("SOLD", now_ms))
            else:
                paused = self.pause(now_ms, f"Couldn't close safely: {why}.")
                out.changed = paused.changed
                out.journal.extend(paused.journal)
            return out

        if self.phase in ("LOBBY", "OPEN") and self.round_elapsed(now_ms) >= self.rules.time_limit_ms:
            self.phase = "UNSOLD"
            self.countdown = None
            self._stop_round_clock(now_ms)
            self._bump(now_ms)
            out.changed = True
            out.journal.append(("UNSOLD", {"reason": "time limit"}))
            out.outbox.append(self._result_record("UNSOLD", now_ms))
        return out

    def _closing_checks(self) -> tuple[bool, str | None]:
        if self.leader_alias is None:
            return False, "no leader"
        if not self.had_competition:
            return False, "two paddles were never on together"
        if self.health["bridge"] != "ok" or self.health["gateway"] != "ok":
            return False, "the gateway or bridge is down"
        if self.result is not None:
            return False, "a result is already recorded"
        return True, None

    def _result_record(self, status: str, now_ms: int) -> tuple[str, str, dict[str, Any]]:
        sold = status == "SOLD" and self.result is not None
        return (
            "AuctionResult",
            f"result:{self.auction_id}:{self.epoch}",
            {
                "auctionId": self.auction_id,
                "epoch": self.epoch,
                "listingId": self.listing_id,
                "category": self.category,
                "status": status,
                "hammerPriceMinor": self.result["hammerPriceMinor"] if sold else 0,
                "closedAtMs": now_ms,
                "winnerAlias": self.result["winnerAlias"] if sold else "",
                "finalSeq": self.result["finalSeq"] if sold else self.server_seq,
                "bidCount": self.bid_count,
                "rulesHash": self.rules_hash or "",
                "transcriptDigest": self.transcript_digest(),
            },
        )

    def transcript_digest(self) -> str:
        """sha256 over the accepted bids, oldest first, as compact JSON with sorted keys.
        Anyone holding the AuctionBid entities can recompute it."""
        bids = sorted(self.bids, key=lambda b: b["bidIndex"])
        canonical = json.dumps(
            [{"bidIndex": b["bidIndex"], "bidderAlias": b["bidderAlias"], "priceMinor": b["priceMinor"], "serverSeq": b["serverSeq"]} for b in bids],
            separators=(",", ":"),
            sort_keys=True,
        )
        return "0x" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def snapshot_record(self, now_ms: int) -> tuple[str, str, dict[str, Any]]:
        return (
            "AuctionSnapshot",
            f"snapshot:{self.auction_id}:{self.epoch}:{self.state_version}",
            {
                "auctionId": self.auction_id,
                "serverSeq": self.server_seq,
                "phase": self.phase,
                "priceMinor": self.price_minor,
                "leaderAlias": self.leader_alias,
                "activeCount": self.active_count(),
                "generatedAtMs": now_ms,
            },
        )

    # ------------------------------------------------------------- views

    def state(self, now_ms: int) -> dict[str, Any]:
        """AuctionState, exactly as web/src/lib/types.ts defines it."""
        return {
            "auctionId": self.auction_id,
            "epoch": self.epoch,
            "stateVersion": self.state_version,
            "phase": self.phase,
            "rules": self.rules.to_json(),
            "priceMinor": self.price_minor,
            "nextPriceMinor": self.next_price_minor,
            "bidCount": self.bid_count,
            "leaderAlias": self.leader_alias,
            "countdown": copy.copy(self.countdown),
            "paddles": [{"alias": s.alias, "status": s.status} for s in self.seats],
            "health": dict(self.health),
            "arkiv": dict(self.arkiv),
            "result": copy.copy(self.result),
            "pauseReason": self.pause_reason,
            "serverTimeMs": now_ms,
        }

    def gateway_view(self, now_ms: int) -> dict[str, Any]:
        """Compact state for the gateway's OLED, LEDs and the tags' feedback."""
        ms_left = max(0, self.countdown["deadlineMs"] - now_ms) if self.countdown else None
        return {
            "phase": self.phase,
            "price": self.price_minor,
            "next": self.next_price_minor,
            "leader": self.leader_alias,
            "msLeft": ms_left,
            "stateVersion": self.state_version,
            "tags": {s.tag_ref: {"alias": s.alias, "status": s.status, "leader": s.alias == self.leader_alias} for s in self.seats},
        }

    # ------------------------------------------------------------- persistence

    def dump(self) -> dict[str, Any]:
        return {
            "auctionId": self.auction_id,
            "listingId": self.listing_id,
            "category": self.category,
            "rules": self.rules.to_json(),
            "epoch": self.epoch,
            "seats": [{"tagRef": s.tag_ref, "alias": s.alias, "status": s.status} for s in self.seats],
            "phase": self.phase,
            "stateVersion": self.state_version,
            "serverSeq": self.server_seq,
            "bidCount": self.bid_count,
            "priceMinor": self.price_minor,
            "leaderAlias": self.leader_alias,
            "countdownGeneration": self.countdown_generation,
            "hadCompetition": self.had_competition,
            "bids": self.bids,
            "lastBidStateVersion": self.last_bid_state_version,
            "result": self.result,
            "pauseReason": self.pause_reason,
            "pausedFrom": self.paused_from,
            "rulesHash": self.rules_hash,
            "seenIntents": [list(k) for k in self.seen_intents],
            "roundElapsedMs": self.round_elapsed_ms,
            "arkiv": self.arkiv,
        }

    @staticmethod
    def restore(data: dict[str, Any], now_ms: int) -> "Auction":
        """Rebuild after a restart. A live round comes back PAUSED: the old deadline can't be trusted."""
        a = Auction(
            data["auctionId"],
            data["listingId"],
            Rules.from_json(data["rules"]),
            [(s["tagRef"], s["alias"]) for s in data["seats"]],
            epoch=data["epoch"],
            category=data.get("category", "Other"),
        )
        for seat, saved in zip(a.seats, data["seats"]):
            seat.status = saved["status"]
        a.phase = data["phase"]
        a.state_version = data["stateVersion"]
        a.server_seq = data["serverSeq"]
        a.bid_count = data["bidCount"]
        a.price_minor = data["priceMinor"]
        a.leader_alias = data["leaderAlias"]
        a.countdown_generation = data["countdownGeneration"]
        a.had_competition = data["hadCompetition"]
        a.bids = data["bids"]
        a.last_bid_state_version = data["lastBidStateVersion"]
        a.result = data["result"]
        a.pause_reason = data["pauseReason"]
        a.paused_from = data["pausedFrom"]
        a.rules_hash = data["rulesHash"]
        a.seen_intents = {(k[0], k[1], int(k[2])) for k in data["seenIntents"]}
        a.round_elapsed_ms = data["roundElapsedMs"]
        a.arkiv = data.get("arkiv", a.arkiv)
        a.health = {"gateway": "ok", "bridge": "down", "engine": "ok"}
        if a.phase in ("LOBBY", "OPEN", "COUNTDOWN"):
            # Paddles must re-announce themselves; the countdown restarts in full on resync.
            for seat in a.seats:
                if seat.status == "ACTIVE":
                    seat.status = "UNKNOWN"
            a.pause(now_ms, "The engine restarted. Waiting for the room to reconnect.")
        elif a.phase == "PAUSED":
            for seat in a.seats:
                if seat.status == "ACTIVE":
                    seat.status = "UNKNOWN"
        return a
