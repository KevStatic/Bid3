#!/usr/bin/env python3
"""Press-to-acknowledgement latency from a paddle's own USB serial.

Each paddle prints one line per BID, timed on its own clock from the button edge to the
engine's acknowledgement arriving back at the tag (see firmware/INTEGRATION_BRIEF.md):

    BID3_LATENCY_JSON={"tag":1,"seq":17,"result":0,"edge_to_tag_ack_ms":142}

Usage
  python tools/latency.py --port /dev/cu.usbmodem-XXXX        live, until Ctrl-C (or --count N)
  python tools/latency.py --file saved-serial-log.txt         from a saved Serial Monitor log
  python tools/latency.py --list-ports

Close the Arduino Serial Monitor first: only one program can hold the port.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter
from collections.abc import Iterable, Iterator

PREFIX = "BID3_LATENCY_JSON="


def samples(lines: Iterable[str]) -> Iterator[dict]:
    for line in lines:
        line = line.strip()
        if not line.startswith(PREFIX):
            continue
        try:
            sample = json.loads(line[len(PREFIX):])
        except json.JSONDecodeError:
            continue
        if isinstance(sample.get("edge_to_tag_ack_ms"), int):
            yield sample


def serial_lines(port: str, baud: int) -> Iterator[str]:
    import serial  # pyserial, from bridge/requirements.txt

    with serial.Serial(port, baud, timeout=1) as conn:
        while True:
            raw = conn.readline()
            if raw:
                yield raw.decode("utf-8", errors="replace")


def summary(values: list[int], results: Counter) -> str:
    ordered = sorted(values)
    p90 = ordered[min(len(ordered) - 1, int(round(0.9 * (len(ordered) - 1))))]
    codes = ", ".join(f"result {code}: {count}" for code, count in sorted(results.items()))
    return (
        f"{len(values)} bids  median {statistics.median(values):.0f} ms  p90 {p90} ms  "
        f"min {ordered[0]} ms  max {ordered[-1]} ms  ({codes})"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Paddle press-to-acknowledgement latency")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--port", help="the paddle's serial port")
    source.add_argument("--file", help="a saved serial log")
    source.add_argument("--list-ports", action="store_true")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--count", type=int, default=0, help="stop after N bids (0 = until Ctrl-C)")
    args = parser.parse_args()

    if args.list_ports:
        from serial.tools import list_ports

        for p in list_ports.comports():
            print(f"{p.device}\t{p.description}")
        return

    lines: Iterable[str] = open(args.file, encoding="utf-8", errors="replace") if args.file else serial_lines(args.port, args.baud)
    values: list[int] = []
    results: Counter = Counter()
    try:
        for sample in samples(lines):
            values.append(sample["edge_to_tag_ack_ms"])
            results[sample.get("result")] += 1
            if args.port:
                print(f"tag {sample.get('tag')} seq {sample.get('seq')}: {sample['edge_to_tag_ack_ms']} ms (result {sample.get('result')})")
            if args.count and len(values) >= args.count:
                break
    except KeyboardInterrupt:
        pass
    if not values:
        sys.exit(f"no {PREFIX} lines seen")
    print(summary(values, results))


if __name__ == "__main__":
    main()
