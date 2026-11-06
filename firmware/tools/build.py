#!/usr/bin/env python3
"""Compile the three hardware sketches with the validated Arduino toolchain."""

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CLI_VERSION = "1.5.1"
CORE_VERSION = "3.3.12"
BOARDS = {
    "Tag01": "esp32:esp32:XIAO_ESP32C3",
    "Tag02": "esp32:esp32:XIAO_ESP32C3",
    "Gateway": "esp32:esp32:esp32",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arduino-cli", default=os.environ.get("ARDUINO_CLI", "arduino-cli"))
    parser.add_argument("--sketch", choices=BOARDS, help="Build only this sketch; default: all three")
    args = parser.parse_args()

    version = subprocess.check_output([args.arduino_cli, "version"], text=True)
    if not re.search(r"\bVersion:\s*" + re.escape(CLI_VERSION) + r"\b", version):
        raise ValueError(f"Arduino CLI {CLI_VERSION} required; found {version.strip()}")
    platforms = json.loads(subprocess.check_output(
        [args.arduino_cli, "core", "list", "--json"], text=True,
    ))["platforms"]
    if not any(
        platform["id"] == "esp32:esp32" and platform.get("installed_version") == CORE_VERSION
        for platform in platforms
    ):
        raise ValueError(f"Install esp32:esp32@{CORE_VERSION}; see firmware/README.md")

    sketches = [args.sketch] if args.sketch else list(BOARDS)
    with tempfile.TemporaryDirectory(prefix="bid3-build-") as directory:
        environment = os.environ.copy()
        environment["ARDUINO_BUILD_CACHE_PATH"] = str(Path(directory) / "cache")
        for sketch in sketches:
            command = [
                args.arduino_cli, "compile", "--fqbn", BOARDS[sketch],
                "--warnings", "all", "--jobs", "4",
                "--build-path", str(Path(directory) / sketch), str(ROOT / sketch),
            ]
            print("+ " + shlex.join(command), flush=True)
            subprocess.run(command, env=environment, check=True)
    print("Compiled: " + ", ".join(sketches) + ". No hardware was flashed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Firmware build failed: {error}", file=sys.stderr)
        sys.exit(1)
