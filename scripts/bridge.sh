#!/usr/bin/env bash
# Runs the bridge on whichever USB port the gateway is on, and keeps it there.
#
#   scripts/bridge.sh            (in the "bridge" terminal; Ctrl-C to stop)
#
# - Waits for the gateway to appear on USB (any /dev/cu.usbserial-* or cu.wchusbserial-*).
# - Starts bridge/bid3_bridge.py on it, with the token from engine/.env.
# - A short unplug with the same port name recovers inside the bridge itself (it retries every 2 s).
#   If the gateway comes back under a different name (it has been both usbserial-10 and -110), or the
#   bridge exits, the bridge is restarted on the new port.
# The bridge itself is unchanged.
set -u
cd "$(dirname "$0")/../bridge" || exit 1
set -a
# shellcheck disable=SC1091
source ../engine/.env
set +a

PY="${BRIDGE_PYTHON:-../engine/.venv/bin/python}"
DEV="${BRIDGE_DEV_DIR:-/dev}"           # overridable for testing
ENGINE_WS="${ENGINE_WS:-ws://localhost:8010}"

find_port() { ls "$DEV" 2>/dev/null | grep -E '^cu\.(usbserial|wchusbserial)' | head -1 | sed "s|^|$DEV/|"; }
say() { echo "$(date +%H:%M:%S) $*"; }

child=""
trap '[ -n "$child" ] && kill "$child" 2>/dev/null; exit 0' INT TERM

while true; do
  port=$(find_port)
  if [ -z "$port" ]; then
    say "No gateway on USB. Plug it in (straight into the Mac is most reliable); waiting…"
    while [ -z "$(find_port)" ]; do sleep 2; done
    continue
  fi
  say "Gateway on $port: starting the bridge."
  "$PY" bid3_bridge.py --port "$port" --engine "$ENGINE_WS" --token "${BRIDGE_TOKEN:-}" &
  child=$!
  while kill -0 "$child" 2>/dev/null; do
    sleep 2
    if [ ! -e "$port" ]; then
      new=$(find_port)
      if [ -n "$new" ] && [ "$new" != "$port" ]; then
        say "Gateway came back as $new: restarting the bridge there."
        kill "$child" 2>/dev/null
        wait "$child" 2>/dev/null
        break
      fi
    fi
  done
  wait "$child" 2>/dev/null
  child=""
  say "Bridge stopped; looking for the gateway again."
  sleep 1
done
