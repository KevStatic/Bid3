"""Runs auctions: one lock serializes every input, a tick loop drives the
countdown, and every committed change is broadcast to browsers and the bridge.

Nothing here decides auction rules; that is all in auction.py.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from .auction import Auction, Outcome, Rules
from .intents import Intent, IntentError, parse_intent, verify_signature
from .store import Store

log = logging.getLogger("bid3.engine")


def wall_ms() -> int:
    return time.time_ns() // 1_000_000


class Sender(Protocol):
    async def send_json(self, data: dict[str, Any]) -> None: ...


class Runtime:
    def __init__(
        self,
        store: Store,
        clock: Callable[[], int] = wall_ms,
        snapshot_interval_ms: int = 4_000,
        auto_resume: bool = True,
        require_signatures: bool = False,
        tick_interval_s: float = 0.05,
    ):
        self.store = store
        self.clock = clock
        self.snapshot_interval_ms = snapshot_interval_ms
        self.auto_resume = auto_resume
        self.require_signatures = require_signatures
        self.tick_interval_s = tick_interval_s

        self.auctions: dict[str, Auction] = {}
        self.public_keys: dict[tuple[str, str], str] = {}  # (auctionId, tagRef) -> pubkey hex
        self.active_auction_id: str | None = None
        self.subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self.bridges: set[Sender] = set()
        self._lock = asyncio.Lock()
        self._tick_task: asyncio.Task[None] | None = None
        self._last_snapshot: dict[str, tuple[int, int]] = {}  # auctionId -> (stateVersion, atMs)

    # ------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        now = self.clock()
        for data in self.store.load_auctions():
            auction = Auction.restore(data, now)
            self.auctions[auction.auction_id] = auction
            for seat in data["seats"]:
                if seat.get("publicKey"):
                    self.public_keys[(auction.auction_id, seat["tagRef"])] = seat["publicKey"]
            if not auction.is_closed() and auction.phase != "DRAFT":
                self.active_auction_id = auction.auction_id
            self._persist(auction, Outcome(changed=True, journal=[("RESTORED", {"phase": auction.phase})]), now)
        self._tick_task = asyncio.create_task(self._tick_loop())

    async def stop(self) -> None:
        if self._tick_task:
            self._tick_task.cancel()
            try:
                await self._tick_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------ admin

    async def create(self, auction_id: str, listing_id: str, rules: Rules, seats: list[dict[str, str]], category: str = "Other") -> Auction:
        async with self._lock:
            if auction_id in self.auctions:
                raise ValueError(f"auction {auction_id} already exists")
            auction = Auction(auction_id, listing_id, rules, [(s["tagRef"], s["alias"]) for s in seats], category=category)
            for s in seats:
                if s.get("publicKey"):
                    self.public_keys[(auction_id, s["tagRef"])] = s["publicKey"]
            if self.bridges:
                auction.health["bridge"] = "ok"
            self.auctions[auction_id] = auction
            self._persist(auction, Outcome(changed=True, journal=[("CREATED", {"rules": rules.to_json()})]), self.clock())
            return auction

    async def open(self, auction_id: str) -> Outcome:
        def open_and_activate(auction: Auction, now: int) -> Outcome:
            out = auction.open(now)
            if out.changed:
                # Become the active auction inside apply(), before it broadcasts: _broadcast only sends the
                # bridge the active auction's state, and that new auctionId is what makes the bridge send
                # CMD=STATUS so the tags re-JOIN this lot.
                self.active_auction_id = auction.auction_id
            return out

        return await self.apply(auction_id, open_and_activate)

    async def pause(self, auction_id: str, reason: str) -> Outcome:
        return await self.apply(auction_id, lambda a, now: a.pause(now, reason), allow_auto_resume=False)

    async def resync(self, auction_id: str) -> Outcome:
        return await self.apply(auction_id, lambda a, now: a.resync(now))

    async def cancel(self, auction_id: str, reason: str) -> Outcome:
        return await self.apply(auction_id, lambda a, now: a.cancel(now, reason))

    # ------------------------------------------------------------ core

    async def apply(
        self,
        auction_id: str,
        fn: Callable[[Auction, int], Outcome],
        allow_auto_resume: bool = True,
        notify_bridge: bool = True,
    ) -> Outcome:
        async with self._lock:
            auction = self.auctions.get(auction_id)
            if auction is None:
                raise KeyError(auction_id)
            now = self.clock()
            out = fn(auction, now)
            if allow_auto_resume and self.auto_resume and auction.phase == "PAUSED" and auction.can_resume()[0]:
                resumed = auction.resync(now)
                out.changed = out.changed or resumed.changed
                out.journal.extend(resumed.journal)
            if out.changed or out.journal or out.outbox:
                self._persist(auction, out, now)
            if out.changed or out.outbox:
                # The gateway only hears about real auction changes, not Arkiv bookkeeping.
                await self._broadcast(auction, now, out.bid, to_bridge=notify_bridge and out.changed)
            return out

    def _persist(self, auction: Auction, out: Outcome, now: int) -> None:
        self.store.commit(auction.auction_id, auction.epoch, auction.state_version, self._dump(auction), out.journal, out.outbox, now)
        auction.arkiv["pending"] = self.store.pending_count(auction.auction_id)

    def _dump(self, auction: Auction) -> dict[str, Any]:
        data = auction.dump()
        for seat in data["seats"]:
            key = self.public_keys.get((auction.auction_id, seat["tagRef"]))
            if key:
                seat["publicKey"] = key
        return data

    async def _broadcast(self, auction: Auction, now: int, bid: dict[str, Any] | None, to_bridge: bool = True) -> None:
        state = auction.state(now)
        message = {"type": "bid", "bid": bid, "state": state} if bid else {"type": "state", "state": state}
        for queue in list(self.subscribers.get(auction.auction_id, ())):
            if queue.full():
                # A slow client is dropped rather than slowing the room; it reconnects and gets a fresh snapshot.
                queue.put_nowait({"type": "_close"})
                continue
            queue.put_nowait(message)
        if to_bridge and auction.auction_id == self.active_auction_id:
            await self._send_bridges({"type": "state", "auctionId": auction.auction_id, **auction.gateway_view(now)})

    async def _send_bridges(self, data: dict[str, Any]) -> None:
        for bridge in list(self.bridges):
            try:
                await bridge.send_json(data)
            except Exception:  # noqa: BLE001 — a dead socket is cleaned up by its handler
                log.warning("dropping a bridge that failed to receive")
                self.bridges.discard(bridge)

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(self.tick_interval_s)
            for auction_id, auction in list(self.auctions.items()):
                if auction.is_closed() or auction.phase == "DRAFT":
                    continue
                try:
                    await self.apply(auction_id, lambda a, now: a.tick(now))
                    await self._maybe_snapshot(auction)
                except Exception:  # noqa: BLE001 — never let one auction stop the clock
                    log.exception("tick failed for %s", auction_id)

    async def _maybe_snapshot(self, auction: Auction) -> None:
        now = self.clock()
        last_version, last_at = self._last_snapshot.get(auction.auction_id, (0, 0))
        if auction.state_version != last_version and now - last_at >= self.snapshot_interval_ms:
            self._last_snapshot[auction.auction_id] = (auction.state_version, now)
            record = auction.snapshot_record(now)
            await self.apply(auction.auction_id, lambda a, n: Outcome(outbox=[record]), allow_auto_resume=False, notify_bridge=False)

    # ------------------------------------------------------------ streams

    def subscribe(self, auction_id: str) -> tuple[asyncio.Queue[dict[str, Any]], dict[str, Any]]:
        auction = self.auctions[auction_id]
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self.subscribers.setdefault(auction_id, set()).add(queue)
        now = self.clock()
        return queue, {"type": "snapshot", "state": auction.state(now), "bids": auction.bids[:200]}

    def unsubscribe(self, auction_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self.subscribers.get(auction_id, set()).discard(queue)

    # ------------------------------------------------------------ bridge

    async def bridge_connected(self, bridge: Sender) -> None:
        self.bridges.add(bridge)
        for auction_id, auction in list(self.auctions.items()):
            if not auction.is_closed():
                await self.apply(auction_id, lambda a, now: a.set_health(now, "bridge", "ok"))
        if self.active_auction_id:
            auction = self.auctions[self.active_auction_id]
            await bridge.send_json({"type": "state", "auctionId": auction.auction_id, **auction.gateway_view(self.clock())})

    async def bridge_disconnected(self, bridge: Sender) -> None:
        self.bridges.discard(bridge)
        if self.bridges:
            return
        for auction_id, auction in list(self.auctions.items()):
            if not auction.is_closed():
                await self.apply(auction_id, lambda a, now: a.set_health(now, "bridge", "down"), allow_auto_resume=False)

    async def gateway_health(self, value: str) -> None:
        for auction_id, auction in list(self.auctions.items()):
            if not auction.is_closed():
                await self.apply(auction_id, lambda a, now: a.set_health(now, "gateway", value), allow_auto_resume=value == "ok")

    async def handle_intent(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Process one intent from the gateway and return the ack sent back to the tag."""
        try:
            intent = parse_intent(raw)
        except IntentError as exc:
            return {"type": "ack", "tag": raw.get("tag"), "seq": raw.get("seq"), "result": "IGNORED", "reason": str(exc)}

        auction_id = self.active_auction_id
        if auction_id is None:
            return self._ack(intent, "CLOSED", "no auction is open")

        if self.require_signatures and intent.kind != "LINK":
            key = self.public_keys.get((auction_id, intent.tag))
            if key is None or not verify_signature(intent, key):
                async with self._lock:
                    auction = self.auctions[auction_id]
                    self.store.commit(
                        auction_id, auction.epoch, auction.state_version, self._dump(auction),
                        [("REJECTED_SIGNATURE", {"tag": intent.tag, "kind": intent.kind, "seq": intent.seq})], [], self.clock(),
                    )
                return self._ack(intent, "IGNORED", "bad or missing signature")

        out = await self.apply(auction_id, lambda a, now: self._dispatch(a, now, intent))
        return self._ack(intent, out.ack or "ACCEPTED", out.reason)

    @staticmethod
    def _dispatch(auction: Auction, now: int, intent: Intent) -> Outcome:
        if intent.kind == "JOIN":
            return auction.join(now, intent.tag, intent.session, intent.seq)
        if intent.kind == "LEAVE":
            return auction.leave(now, intent.tag, intent.session, intent.seq)
        if intent.kind == "BID":
            return auction.bid(now, intent.tag, intent.session, intent.seq, intent.state_version)
        return auction.link(now, intent.tag, bool(intent.link_ok))

    @staticmethod
    def _ack(intent: Intent, result: str, reason: str | None) -> dict[str, Any]:
        return {"type": "ack", "tag": intent.tag, "seq": intent.seq, "kind": intent.kind, "result": result, "reason": reason}

    # ------------------------------------------------------------ outbox

    async def outbox_published(self, outbox_id: int, entity_key: str, tx_hash: str | None) -> bool:
        record = self.store.mark_published(outbox_id, entity_key, tx_hash, self.clock())
        if record is None:
            return False
        auction_id = record["auctionId"]
        if auction_id in self.auctions:
            def update(a: Auction, now: int) -> Outcome:
                seq = record["payload"].get("serverSeq") or record["payload"].get("finalSeq") or a.server_seq
                a.arkiv["lastPublishedSeq"] = seq
                a.arkiv["lastPublishedAtMs"] = now
                return Outcome(changed=True)

            await self.apply(auction_id, update, allow_auto_resume=False, notify_bridge=False)
        return True

    def outbox_failed(self, outbox_id: int, error: str) -> None:
        self.store.mark_failed(outbox_id, error)


Handler = Callable[[dict[str, Any]], Awaitable[None]]
