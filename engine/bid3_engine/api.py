"""HTTP and WebSocket API.

Public (read-only)
  GET  /health
  GET  /auctions
  GET  /auctions/{id}                 state + bids
  WS   /auctions/{id}/stream          snapshot, then state/bid messages (web/src/lib/types.ts)

Bridge (BRIDGE_TOKEN)
  WS   /bridge?token=...              gateway intents in, gateway state + acks out

Operator (Authorization: Bearer ADMIN_TOKEN)
  POST /auctions                      create a DRAFT auction with frozen-to-be rules and seats
  POST /auctions/{id}/open            freeze rules, publish definition, let paddles join
  POST /auctions/{id}/pause|resync|cancel
  GET  /auctions/{id}/journal         every input, accepted and refused

Arkiv worker (Authorization: Bearer WORKER_TOKEN)
  GET  /outbox                        records waiting to be written to Arkiv
  POST /outbox/{id}/published         {entityKey, txHash}
  POST /outbox/{id}/failed            {error}
"""

from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auction import Rules
from .config import Settings, load_settings
from .runtime import Runtime
from .store import Store

log = logging.getLogger("bid3.engine")


class RulesIn(BaseModel):
    startPriceMinor: int = Field(gt=0)
    stepBps: int = Field(gt=0, le=10_000)
    countdownMs: int = Field(ge=1_000, le=60_000)
    ceilingMinor: int = Field(gt=0)
    timeLimitMs: int = Field(ge=60_000)
    unit: str = "demo credits"


class SeatIn(BaseModel):
    tagRef: str = Field(min_length=1, max_length=128)
    alias: str = Field(min_length=1, max_length=8)
    publicKey: str | None = None


class AuctionIn(BaseModel):
    auctionId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    listingId: str = Field(min_length=1, max_length=64)
    category: str = Field(default="Other", max_length=40)
    rules: RulesIn
    seats: list[SeatIn] = Field(min_length=2, max_length=16)


class ReasonIn(BaseModel):
    reason: str = Field(default="Operator action", max_length=200)


class PublishedIn(BaseModel):
    entityKey: str = Field(min_length=3, max_length=130)
    txHash: str | None = Field(default=None, max_length=130)


class FailedIn(BaseModel):
    error: str = Field(max_length=500)


def _token_ok(expected: str, given: str | None) -> bool:
    if not expected:
        return True  # local development only
    return given is not None and hmac.compare_digest(expected, given)


def create_app(settings: Settings | None = None, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or load_settings()
    store = runtime.store if runtime else Store(settings.database_path)
    runtime = runtime or Runtime(
        store,
        snapshot_interval_ms=settings.snapshot_interval_ms,
        auto_resume=settings.auto_resume,
        require_signatures=settings.require_signatures,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await runtime.start()
        if settings.seed_demo and "bid3-003" not in runtime.auctions:
            await _seed_demo(runtime, settings)
        if not (settings.bridge_token and settings.admin_token and settings.worker_token):
            log.warning("one or more tokens are empty: fine locally, never in a deployment")
        yield
        await runtime.stop()

    app = FastAPI(title="Bid3 engine", version="0.1.0", lifespan=lifespan)
    app.state.runtime = runtime
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def admin(authorization: str | None = Header(default=None)) -> None:
        if not _token_ok(settings.admin_token, (authorization or "").removeprefix("Bearer ").strip() or None):
            raise HTTPException(401, "operator token required")

    def worker(authorization: str | None = Header(default=None)) -> None:
        if not _token_ok(settings.worker_token, (authorization or "").removeprefix("Bearer ").strip() or None):
            raise HTTPException(401, "worker token required")

    def auction_or_404(auction_id: str):
        auction = runtime.auctions.get(auction_id)
        if auction is None:
            raise HTTPException(404, f"no auction {auction_id}")
        return auction

    # ------------------------------------------------------------ public

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "activeAuctionId": runtime.active_auction_id,
            "bridgeConnected": bool(runtime.bridges),
            "auctions": len(runtime.auctions),
            "signaturesRequired": runtime.require_signatures,
            "serverTimeMs": runtime.clock(),
        }

    @app.get("/auctions")
    async def list_auctions() -> list[dict[str, Any]]:
        now = runtime.clock()
        return [
            {"auctionId": a.auction_id, "listingId": a.listing_id, "phase": a.phase, "priceMinor": a.price_minor, "bidCount": a.bid_count, "stateVersion": a.state_version, "serverTimeMs": now}
            for a in runtime.auctions.values()
        ]

    @app.get("/auctions/{auction_id}")
    async def get_auction(auction_id: str) -> dict[str, Any]:
        auction = auction_or_404(auction_id)
        return {"state": auction.state(runtime.clock()), "bids": auction.bids[:200], "rulesHash": auction.rules_hash}

    @app.websocket("/auctions/{auction_id}/stream")
    async def stream(ws: WebSocket, auction_id: str) -> None:
        if auction_id not in runtime.auctions:
            await ws.close(code=4404)
            return
        await ws.accept()
        queue, snapshot = runtime.subscribe(auction_id)
        try:
            await ws.send_json(snapshot)
            while True:
                message = await queue.get()
                if message.get("type") == "_close":
                    await ws.close(code=4008)
                    return
                await ws.send_json(message)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            runtime.unsubscribe(auction_id, queue)

    # ------------------------------------------------------------ bridge

    @app.websocket("/bridge")
    async def bridge(ws: WebSocket, token: str | None = Query(default=None)) -> None:
        if not _token_ok(settings.bridge_token, token):
            await ws.close(code=4401)
            return
        await ws.accept()

        class Conn:
            async def send_json(self, data: dict[str, Any]) -> None:
                await ws.send_json(data)

        conn = Conn()
        await runtime.bridge_connected(conn)
        try:
            while True:
                message = await ws.receive_json()
                kind = message.get("type")
                if kind == "intent":
                    ack = await runtime.handle_intent(message.get("intent") or {})
                    await ws.send_json(ack)
                elif kind == "health":
                    await runtime.gateway_health("ok" if message.get("gateway") == "ok" else "down")
                elif kind == "ping":
                    await ws.send_json({"type": "pong", "serverTimeMs": runtime.clock()})
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            await runtime.bridge_disconnected(conn)

    # ------------------------------------------------------------ operator

    @app.post("/auctions", dependencies=[Depends(admin)], status_code=201)
    async def create_auction(body: AuctionIn) -> dict[str, Any]:
        try:
            rules = Rules.from_json(body.rules.model_dump())
            auction = await runtime.create(body.auctionId, body.listingId, rules, [s.model_dump() for s in body.seats], category=body.category)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"state": auction.state(runtime.clock())}

    @app.post("/auctions/{auction_id}/open", dependencies=[Depends(admin)])
    async def open_auction(auction_id: str) -> dict[str, Any]:
        auction_or_404(auction_id)
        out = await runtime.open(auction_id)
        if not out.changed:
            raise HTTPException(409, out.reason or "could not open")
        return {"state": runtime.auctions[auction_id].state(runtime.clock())}

    @app.post("/auctions/{auction_id}/pause", dependencies=[Depends(admin)])
    async def pause_auction(auction_id: str, body: ReasonIn) -> dict[str, Any]:
        auction_or_404(auction_id)
        await runtime.pause(auction_id, body.reason)
        return {"state": runtime.auctions[auction_id].state(runtime.clock())}

    @app.post("/auctions/{auction_id}/resync", dependencies=[Depends(admin)])
    async def resync_auction(auction_id: str) -> dict[str, Any]:
        auction_or_404(auction_id)
        out = await runtime.resync(auction_id)
        if not out.changed:
            raise HTTPException(409, out.reason or "cannot resume yet")
        return {"state": runtime.auctions[auction_id].state(runtime.clock())}

    @app.post("/auctions/{auction_id}/cancel", dependencies=[Depends(admin)])
    async def cancel_auction(auction_id: str, body: ReasonIn) -> dict[str, Any]:
        auction_or_404(auction_id)
        out = await runtime.cancel(auction_id, body.reason)
        if not out.changed:
            raise HTTPException(409, out.reason or "cannot cancel")
        return {"state": runtime.auctions[auction_id].state(runtime.clock())}

    @app.get("/auctions/{auction_id}/journal", dependencies=[Depends(admin)])
    async def journal(auction_id: str, limit: int = 200) -> list[dict[str, Any]]:
        auction_or_404(auction_id)
        return runtime.store.journal(auction_id, min(limit, 1000))

    # ------------------------------------------------------------ worker

    @app.get("/outbox", dependencies=[Depends(worker)])
    async def outbox(limit: int = 20) -> list[dict[str, Any]]:
        return runtime.store.pending_outbox(min(limit, 100))

    @app.post("/outbox/{outbox_id}/published", dependencies=[Depends(worker)])
    async def published(outbox_id: int, body: PublishedIn) -> dict[str, bool]:
        if not await runtime.outbox_published(outbox_id, body.entityKey, body.txHash):
            raise HTTPException(404, "no such outbox record")
        return {"ok": True}

    @app.post("/outbox/{outbox_id}/failed", dependencies=[Depends(worker)])
    async def failed(outbox_id: int, body: FailedIn) -> dict[str, bool]:
        runtime.outbox_failed(outbox_id, body.error)
        return {"ok": True}

    return app


async def _seed_demo(runtime: Runtime, settings: Settings) -> None:
    seats = []
    for pair in settings.seed_tags.split(","):
        tag, _, alias = pair.partition(":")
        if tag.strip() and alias.strip():
            seats.append({"tagRef": tag.strip(), "alias": alias.strip()})
    rules = Rules(
        start_price_minor=10_000,
        step_bps=500,
        countdown_ms=settings.seed_countdown_ms,
        ceiling_minor=100_000,
        time_limit_ms=10 * 60_000,
    )
    await runtime.create("bid3-003", "lot-003", rules, seats, category="Electronics")
    await runtime.open("bid3-003")
    log.info("seeded demo auction bid3-003 with paddles %s", ", ".join(s["alias"] for s in seats))

