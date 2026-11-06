#!/usr/bin/env python3
"""Check release integrity, standalone sketch copies and all host regressions."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "SHA256SUMS.json"
IGNORED_DIRS = {"__pycache__", ".venv", ".build", "build", ".cache", ".git"}
IGNORED_SUFFIXES = {".pyc", ".pyo", ".bin", ".elf", ".hex", ".map", ".o", ".a", ".zip"}


def source_hashes():
    result = {}
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if (
            not path.is_file()
            or path == MANIFEST
            or IGNORED_DIRS.intersection(relative.parts)
            or path.name == ".DS_Store"
            or path.suffix in IGNORED_SUFFIXES
            or path.name == ".env"
            or path.name.startswith(".env.")
        ):
            continue
        result[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def check_integrity():
    expected = json.loads(MANIFEST.read_text())
    actual = source_hashes()
    differences = sorted(
        name for name in expected.keys() | actual.keys()
        if expected.get(name) != actual.get(name)
    )
    if differences:
        raise ValueError("Checksum mismatch or unlisted file: " + ", ".join(differences))
    copies = 0
    for canonical in sorted((ROOT / "shared").glob("*.h")):
        targets = [ROOT / board / canonical.name for board in ("Tag01", "Tag02")]
        gateway_copy = ROOT / "Gateway" / canonical.name
        if gateway_copy.exists():
            targets.append(gateway_copy)
        for target in targets:
            if not target.is_file() or target.read_bytes() != canonical.read_bytes():
                raise ValueError(f"Shared header drift: {target.relative_to(ROOT)}")
            copies += 1
    print(f"Verified {len(actual)} file hashes and {copies} shared header copies", flush=True)


def run(command):
    print("+ " + shlex.join(map(str, command)), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-checksums", action="store_true",
        help="Regenerate the manifest after reviewing intentional source changes, then exit",
    )
    args = parser.parse_args()
    if args.update_checksums:
        MANIFEST.write_text(json.dumps(source_hashes(), indent=2, sort_keys=True) + "\n")
        print("Updated SHA256SUMS.json; review its diff before committing.")
        return

    check_integrity()
    run([sys.executable, "-B", "-m", "unittest", "discover", "-s", "tools", "-p", "test_*.py", "-v"])
    compiler = shlex.split(os.environ.get("CXX", "clang++"))
    with tempfile.TemporaryDirectory(prefix="bid3-host-") as directory:
        tests = sorted((ROOT / "tools").glob("test_*.cpp"))
        for source in tests:
            executable = Path(directory) / source.stem
            run(compiler + [
                "-std=c++17", "-Wall", "-Wextra", "-Werror",
                "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
                "-fno-sanitize-recover=all", "-Itools/audio_mock",
                str(source.relative_to(ROOT)), "-o", str(executable),
            ])
            run([str(executable)])
    print(f"All Python tests and {len(tests)} C++ host programs passed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Firmware check failed: {error}", file=sys.stderr)
        sys.exit(1)
