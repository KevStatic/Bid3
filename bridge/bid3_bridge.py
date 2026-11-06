#!/usr/bin/env python3
"""Bid3 bridge: the gateway's USB serial <-> the Bid3 engine.

Runs on the laptop the gateway is plugged into. It dials OUT to the engine
over WebSocket, so the laptop needs no public address.

Serial protocol (115200 baud, one line per message):

  gateway -> bridge
    AUCTION_EVENT_JSON={"kind":"BID","tag":"TAG1","session":"b7","seq":17,"stateVersion":42}
    AUCTION_EVENT_JSON={"kind":"JOIN","tag":"TAG2","seq":3}
    AUCTION_EVENT_JSON={"kind":"LINK","tag":"TAG2","link":"LOST"}
    (any other line, e.g. SCAN_JSON=..., is ignored)

  bridge -> gateway
    AUCTION_STATE_JSON={"phase":"COUNTDOWN","price":11025,"next":11576,"leader":"K7","msLeft":3200,"stateVersion":42,"tags":{...}}
    AUCTION_ACK_JSON={"tag":"TAG1","seq":17,"kind":"BID","result":"ACCEPTED","reason":null}
    CMD=STATUS      ask the gateway to re-send JOIN (or LINK OK) for every connected, switched-on tag

Usage
  python bid3_bridge.py --port /dev/cu.usbserial-0001          real gateway
  python bid3_bridge.py --keyboard                              no hardware: type "join TAG1", "bid TAG2", ...
  python bid3_bridge.py --list-ports

Settings come from flags or env: ENGINE_URL, BRIDGE_TOKEN, SERIAL_PORT, SERIAL_BAUD.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import sys
import threading
import time
from typing import Any
from collections import defaultdict, deque

import websockets

log = logging.getLogger("bid3.bridge")

EVENT_PREFIX = "AUCTION_EVENT_JSON="
STATE_PREFIX = "AUCTION_STATE_JSON="
ACK_PREFIX = "AUCTION_ACK_JSON="


# ---------------------------------------------------------------- gateway side


class Gateway:
    """The serial link. Reads in a background thread, writes under a lock, reopens on failure."""

    def __init__(self, port: str, baud: int, loop: asyncio.AbstractEventLoop, inbox: asyncio.Queue[Any]):
        self.port_name = port
        self.baud = baud
        self.loop = loop
        self.inbox = inbox
        self._serial = None
        self._write_lock = threading.Lock()
        self._stop = threading.Event()
        self.connected = False
        self.last_status_at = 0.0

    def start(self) -> None:
        threading.Thread(target=self._run, name="serial-reader", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def _emit(self, item: Any) -> None:
        self.loop.call_soon_threadsafe(self.inbox.put_nowait, item)

    def _run(self) -> None:
        import serial  # pyserial

        while not self._stop.is_set():
            try:
                self._serial = serial.Serial(self.port_name, self.baud, timeout=0.05)
                self.connected = True
                self.last_status_at = 0.0
                log.info("gateway connected on %s", self.port_name)
                self._emit(("gateway", "ok"))
                buffer = b""
                while not self._stop.is_set():
                    # Return on the first byte, then drain only bytes already available.
                    # read(256) waits for its timeout when a short JSON line arrives.
                    first = self._serial.read(1)
                    chunk = first + (self._serial.read(self._serial.in_waiting) if first and self._serial.in_waiting else b"")
                    if not chunk:
                        continue
                    buffer += chunk
                    if len(buffer) > 16384:
                        raise OSError("gateway serial line exceeds 16 KiB")
                    while b"\n" in buffer:
                        raw, buffer = buffer.split(b"\n", 1)
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            if line.startswith("AUCTION_STATUS_JSON="):
                                with contextlib.suppress(json.JSONDecodeError):
                                    status = json.loads(line[len("AUCTION_STATUS_JSON="):])
                                    if isinstance(status, dict) and status.get("build") == "V4_WORKING_BASE" and status.get("running") is True:
                                        self.last_status_at = time.monotonic()
                            self._emit(("line", line))
            except Exception as exc:  # noqa: BLE001 — unplugged, busy, permissions...
                if self.connected:
                    log.warning("gateway lost: %s", exc)
                    self._emit(("gateway", "down"))
                self.connected = False
                with contextlib.suppress(Exception):
                    if self._serial:
                        self._serial.close()
                time.sleep(2)

    def write_line(self, line: str) -> None:
        if not self.connected or self._serial is None:
            return
        with self._write_lock:
            try:
                self._serial.write((line + "\n").encode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                log.warning("write to gateway failed: %s", exc)


class KeyboardGateway:
    """Stands in for the gateway: type paddle actions, see what the gateway would receive."""

    HELP = "commands: join TAG | leave TAG | bid TAG | lost TAG | ok TAG | raw {json} | help | quit"

    def __init__(self, loop: asyncio.AbstractEventLoop, inbox: asyncio.Queue[Any]):
        self.loop = loop
        self.inbox = inbox
        self.connected = True
        self.seq: dict[str, int] = {}
        self.session = f"kb{int(time.time()) % 100000}"
        self.last_state_version: int | None = None

    def start(self) -> None:
        print(self.HELP)
        threading.Thread(target=self._run, name="keyboard", daemon=True).start()
        self.loop.call_soon_threadsafe(self.inbox.put_nowait, ("gateway", "ok"))

    def stop(self) -> None:
        pass

    def _next_seq(self, tag: str) -> int:
        self.seq[tag] = self.seq.get(tag, 0) + 1
        return self.seq[tag]

    def _run(self) -> None:
        for raw in sys.stdin:
            parts = raw.strip().split(maxsplit=1)
            if not parts:
                continue
            cmd, arg = parts[0].lower(), (parts[1] if len(parts) > 1 else "")
            event: dict[str, Any] | None = None
            if cmd in ("quit", "exit"):
                os._exit(0)
            elif cmd == "help":
                print(self.HELP)
            elif cmd == "raw":
                try:
                    event = json.loads(arg)
                except json.JSONDecodeError as exc:
                    print(f"bad json: {exc}")
            elif cmd in ("join", "leave", "bid") and arg:
                tag = arg.upper()
                event = {"kind": cmd.upper(), "tag": tag, "session": self.session, "seq": self._next_seq(tag)}
                if cmd == "bid" and self.last_state_version is not None:
                    event["stateVersion"] = self.last_state_version
            elif cmd in ("lost", "ok") and arg:
                event = {"kind": "LINK", "tag": arg.upper(), "link": "LOST" if cmd == "lost" else "OK"}
            else:
                print(self.HELP)
            if event is not None:
                self.loop.call_soon_threadsafe(self.inbox.put_nowait, ("line", EVENT_PREFIX + json.dumps(event)))

    def write_line(self, line: str) -> None:
        if line.startswith(STATE_PREFIX):
            state = json.loads(line[len(STATE_PREFIX):])
            self.last_state_version = state.get("stateVersion", self.last_state_version)
            left = state.get("msLeft")
            leader = state.get("leader") or "-"
            price = state.get("price")
            price_text = f"{price / 100:.2f}" if isinstance(price, int) else "-"
            extra = f"  {left / 1000:.1f}s left" if isinstance(left, int) else ""
            reason = f"  ({state['reason']})" if state.get("reason") else ""
            print(f"  [room] {state.get('phase')}  price {price_text}  leader {leader}{extra}{reason}")
        elif line.startswith(ACK_PREFIX):
            ack = json.loads(line[len(ACK_PREFIX):])
            reason = f" ({ack['reason']})" if ack.get("reason") else ""
            print(f"  [ack]  {ack.get('kind')} {ack.get('tag')}: {ack.get('result')}{reason}")
        elif line.startswith("CMD="):
            print(f"  [gateway] {line}  (re-announce switched-on tags with: join TAG)")


# ---------------------------------------------------------------- engine side


async def run(engine_url: str, token: str, gateway: Gateway | KeyboardGateway, inbox: asyncio.Queue[Any]) -> None:
    url = f"{engine_url.rstrip('/')}/bridge?token={token}"
    attempt = 0
    gateway_ok = False

    while True:
        try:
            async with websockets.connect(url, ping_interval=10, ping_timeout=10, max_size=2**20) as ws:
                attempt = 0
                log.info("engine connected: %s", engine_url)
                if gateway_ok:
                    healthy = not isinstance(gateway, Gateway) or time.monotonic() - gateway.last_status_at < 1.5
                    await ws.send(json.dumps({"type": "health", "gateway": "ok" if healthy else "down"}))
                gateway.write_line("CMD=STATUS")

                pending_sessions: dict[tuple[str, int], deque[str]] = defaultdict(deque)
                last_auction_id: str | None = None

                async def engine_heartbeat() -> None:
                    while True:
                        pong = await ws.ping()
                        await asyncio.wait_for(pong, timeout=2.0)
                        healthy = gateway.connected and (not isinstance(gateway, Gateway) or time.monotonic() - gateway.last_status_at < 1.5)
                        await ws.send(json.dumps({"type":"health","gateway":"ok" if healthy else "down"}))
                        gateway.write_line('AUCTION_BRIDGE_JSON={"engine":"ok"}')
                        await asyncio.sleep(0.5)

                async def from_engine() -> None:
                    nonlocal last_auction_id
                    async for raw in ws:
                        message = json.loads(raw)
                        if message.get("type") == "state":
                            message.pop("type", None)
                            auction_id = message.pop("auctionId", None)
                            changed_round = isinstance(auction_id, str) and auction_id != last_auction_id
                            if changed_round:
                                last_auction_id = auction_id
                            gateway.write_line(STATE_PREFIX + json.dumps(message, separators=(",", ":")))
                            if changed_round:
                                gateway.write_line("CMD=STATUS")
                        elif message.get("type") == "ack":
                            message.pop("type", None)
                            identity = (str(message.get("tag", "")), message.get("seq"))
                            sessions = pending_sessions.get(identity)
                            if sessions:
                                message["session"] = sessions.popleft()
                                if not sessions:
                                    pending_sessions.pop(identity, None)
                            gateway.write_line(ACK_PREFIX + json.dumps(message, separators=(",", ":")))

                async def from_gateway() -> None:
                    nonlocal gateway_ok
                    while True:
                        kind, value = await inbox.get()
                        if kind == "gateway":
                            gateway_ok = value == "ok"
                            healthy = value == "ok" and (not isinstance(gateway, Gateway) or time.monotonic() - gateway.last_status_at < 1.5)
                            await ws.send(json.dumps({"type": "health", "gateway": "ok" if healthy else "down"}))
                            if gateway_ok:
                                gateway.write_line("CMD=STATUS")
                        elif kind == "line" and value.startswith(EVENT_PREFIX):
                            try:
                                event = json.loads(value[len(EVENT_PREFIX):])
                            except json.JSONDecodeError:
                                log.warning("bad event line from gateway: %s", value[:200])
                                continue
                            if event.get("kind") in ("JOIN", "LEAVE", "BID") and isinstance(event.get("seq"), int) and isinstance(event.get("session"), str):
                                pending_sessions[(str(event.get("tag", "")), event["seq"])].append(event["session"])
                            await ws.send(json.dumps({"type": "intent", "intent": event}))
                        elif kind == "line":
                            log.debug("gateway: %s", value[:200])

                tasks = [asyncio.create_task(from_engine()), asyncio.create_task(from_gateway()), asyncio.create_task(engine_heartbeat())]
                try:
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
                    raise ConnectionError("engine stream ended")
                finally:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)

        except (OSError, TimeoutError, websockets.WebSocketException) as exc:
            attempt += 1
            delay = min(8.0, 0.5 * 2**attempt)
            log.warning("engine unreachable (%s); retrying in %.1fs", exc, delay)
            # Tell the room display the truth, and refuse presses rather than queueing stale ones.
            gateway.write_line('AUCTION_BRIDGE_JSON={"engine":"down"}')
            gateway.write_line(STATE_PREFIX + json.dumps({"phase": "PAUSED", "reason": "engine offline"}, separators=(",", ":")))
            deadline = time.monotonic() + delay
            while time.monotonic() < deadline:
                try:
                    kind, value = await asyncio.wait_for(inbox.get(), timeout=max(0.05, deadline - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                if kind == "gateway":
                    gateway_ok = value == "ok"
                elif kind == "line" and value.startswith(EVENT_PREFIX):
                    with contextlib.suppress(json.JSONDecodeError):
                        event = json.loads(value[len(EVENT_PREFIX):])
                        ack = {"tag": event.get("tag"), "seq": event.get("seq"), "session": event.get("session"), "kind": event.get("kind"), "result": "CLOSED", "reason": "engine offline"}
                        gateway.write_line(ACK_PREFIX + json.dumps(ack, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Bid3 bridge: gateway serial <-> engine")
    parser.add_argument("--engine", default=os.environ.get("ENGINE_URL", "ws://localhost:8000"), help="engine WebSocket base URL (ws:// or wss://)")
    parser.add_argument("--token", default=os.environ.get("BRIDGE_TOKEN", ""), help="engine BRIDGE_TOKEN")
    parser.add_argument("--port", default=os.environ.get("SERIAL_PORT"), help="gateway serial port, e.g. /dev/cu.usbserial-0001")
    parser.add_argument("--baud", type=int, default=int(os.environ.get("SERIAL_BAUD", "115200")))
    parser.add_argument("--keyboard", action="store_true", help="no hardware: type paddle actions")
    parser.add_argument("--list-ports", action="store_true", help="list serial ports and exit")
    parser.add_argument("--verbose", "-v", action="store_true", help="also log every other gateway line")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.list_ports:
        from serial.tools import list_ports

        for p in list_ports.comports():
            print(f"{p.device}\t{p.description}")
        return

    if not args.keyboard and not args.port:
        parser.error("give --port (see --list-ports) or use --keyboard")

    async def amain() -> None:
        loop = asyncio.get_running_loop()
        inbox: asyncio.Queue[Any] = asyncio.Queue()
        gateway: Gateway | KeyboardGateway = KeyboardGateway(loop, inbox) if args.keyboard else Gateway(args.port, args.baud, loop, inbox)
        gateway.start()
        try:
            await run(args.engine, args.token, gateway, inbox)
        finally:
            gateway.stop()

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(amain())


if __name__ == "__main__":
    main()
