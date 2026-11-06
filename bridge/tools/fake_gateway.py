#!/usr/bin/env python3
"""A pretend gateway on a virtual serial port (macOS/Linux), for testing the bridge
and engine without hardware.

    python tools/fake_gateway.py            # prints the port path, then plays a scripted round
    python bid3_bridge.py --port <that path>

It speaks the same serial protocol the real gateway firmware must speak
(see bid3_bridge.py), and prints every state/ack line it receives.
"""

from __future__ import annotations

import argparse
import json
import os
import select
import sys
import time
import tty

SCRIPT = [
    (1.0, {"kind": "JOIN", "tag": "TAG1"}),
    (1.0, {"kind": "JOIN", "tag": "TAG2"}),
    (1.5, {"kind": "BID", "tag": "TAG1"}),
    (1.5, {"kind": "BID", "tag": "TAG2"}),
    (0.3, {"kind": "BID", "tag": "TAG2"}),  # already leading: refused
    (1.2, {"kind": "BID", "tag": "TAG1"}),
    (1.0, {"kind": "LEAVE", "tag": "TAG2"}),
    (1.0, {"kind": "JOIN", "tag": "TAG2"}),
    (0.8, {"kind": "BID", "tag": "TAG2"}),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hold", type=float, default=9.0, help="seconds to keep listening after the script")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    master, slave = os.openpty()
    tty.setraw(slave)
    print(f"PORT {os.ttyname(slave)}", flush=True)

    session = f"fg{int(time.time()) % 10000}"
    seq = {"TAG1": 0, "TAG2": 0}
    state_version: int | None = None
    buffer = b""
    received: list[dict] = []

    def pump(timeout: float) -> None:
        nonlocal buffer, state_version
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                return
            ready, _, _ = select.select([master], [], [], left)
            if not ready:
                return
            buffer += os.read(master, 4096)
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                text = line.decode().strip()
                if text.startswith("AUCTION_STATE_JSON="):
                    state = json.loads(text.split("=", 1)[1])
                    state_version = state.get("stateVersion", state_version)
                    received.append({"state": state})
                    if not args.quiet:
                        print(f"<- state {state.get('phase')} price={state.get('price')} leader={state.get('leader')} v={state.get('stateVersion')}", flush=True)
                elif text.startswith("AUCTION_ACK_JSON="):
                    ack = json.loads(text.split("=", 1)[1])
                    received.append({"ack": ack})
                    if not args.quiet:
                        print(f"<- ack {ack.get('kind')} {ack.get('tag')} {ack.get('result')} {ack.get('reason') or ''}", flush=True)
                elif text:
                    print(f"<- {text}", flush=True)

    def send(event: dict) -> None:
        tag = event["tag"]
        seq[tag] += 1
        payload = {**event, "session": session, "seq": seq[tag]}
        if event["kind"] == "BID" and state_version is not None:
            payload["stateVersion"] = state_version
        os.write(master, b"SCAN_JSON={\"noise\":true}\n")  # other gateway output must be ignored
        os.write(master, ("AUCTION_EVENT_JSON=" + json.dumps(payload) + "\n").encode())
        print(f"-> {payload['kind']} {tag} seq={payload['seq']}", flush=True)

    pump(3.0)  # give the bridge time to open the port and connect
    for delay, event in SCRIPT:
        pump(delay)
        send(event)
    pump(args.hold)

    phases = [r["state"]["phase"] for r in received if "state" in r]
    print(f"FINAL {phases[-1] if phases else 'none'}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
