#!/usr/bin/env bash
# Run rounds back to back with no typing: open the next lot, show its progress, and when it sells,
# open the next one after a short pause so the "Sold" screen stays up for a moment.
#
#   scripts/auto-rounds.sh                  start (or keep watching the lot that's already running)
#   PAUSE_S=30 scripts/auto-rounds.sh       seconds between a sale and the next lot (default 20)
#   scripts/auto-rounds.sh --watch <id>     only show one lot's progress, e.g. --watch bid3-005
#
# Paddles that stay switched on rejoin each new lot by themselves: when a lot opens, the bridge asks the
# gateway to re-announce every connected tag (CMD=STATUS). The open Live room page follows to the new lot.
#
# It stops by itself when a lot closes UNSOLD or CANCELLED (nobody bid within the lot's time limit), so an
# unattended room doesn't keep publishing empty lots to Arkiv. Ctrl-C stops it at any time; a lot that's
# already open stays open.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${ENGINE:-http://localhost:8010}"
PAUSE_S="${PAUSE_S:-20}"

# Print a line whenever the lot's phase, bid count or leader changes. Returns when the lot closes,
# leaving its final phase in $PHASE.
watch_lot() {
  local id="$1" last="" line bids leader price paddles reason
  PHASE=""
  while true; do
    line=$(curl -fsS -m 5 "$ENGINE/auctions/$id" 2>/dev/null \
      | jq -r '.state | [.phase, (.bidCount // 0), (.leaderAlias // "-"), (.priceMinor // 0),
                        ([.paddles[] | "\(.alias):\(.status)"] | join(",")), (.pauseReason // "")] | @tsv' 2>/dev/null || true)
    if [ -z "$line" ]; then
      [ "$last" = "unreachable" ] || echo "$(date +%T)  $id  engine not reachable, retrying…"
      last="unreachable"
      sleep 2
      continue
    fi
    IFS=$'\t' read -r PHASE bids leader price paddles reason <<<"$line"
    if [ "$line" != "$last" ]; then
      printf '%s  %s  %-11s %2s bids  leader %-3s  %d.%02d  [%s]%s\n' "$(date +%T)" "$id" "$PHASE" "$bids" "$leader" \
        $((price / 100)) $((price % 100)) "$paddles" "${reason:+  $reason}"
      last="$line"
    fi
    case "$PHASE" in SOLD_LOCKED | UNSOLD | CANCELLED) return 0 ;; esac
    sleep 1
  done
}

# After a lot closes: keep going after a sale, stop otherwise.
next_or_stop() {
  if [ "$PHASE" != "SOLD_LOCKED" ]; then
    echo
    echo "$1 closed $PHASE. Stopping, so empty lots aren't published to Arkiv."
    echo "Run scripts/auto-rounds.sh again when people are ready to bid."
    exit 0
  fi
  echo
  echo "Sold. Next lot in ${PAUSE_S} s (Ctrl-C to stop)."
  sleep "$PAUSE_S"
}

if [ "${1:-}" = "--watch" ]; then
  [ -n "${2:-}" ] || { echo "usage: scripts/auto-rounds.sh --watch <auction id>" >&2; exit 1; }
  watch_lot "$2"
  exit 0
fi

curl -fsS -m 5 "$ENGINE/health" >/dev/null || { echo "engine not reachable at $ENGINE" >&2; exit 1; }

# If a lot is still running, finish it before opening another.
ACTIVE=$(curl -fsS -m 5 "$ENGINE/health" | jq -r '.activeAuctionId // empty')
if [ -n "$ACTIVE" ]; then
  ACTIVE_PHASE=$(curl -fsS -m 5 "$ENGINE/auctions/$ACTIVE" | jq -r '.state.phase')
  case "$ACTIVE_PHASE" in
    SOLD_LOCKED | UNSOLD | CANCELLED) ;;
    *)
      echo "$ACTIVE is still running ($ACTIVE_PHASE). Watching it first."
      watch_lot "$ACTIVE"
      next_or_stop "$ACTIVE"
      ;;
  esac
fi

while true; do
  echo
  "$ROOT/scripts/new-lot.sh"
  ID=$(curl -fsS -m 5 "$ENGINE/health" | jq -r '.activeAuctionId')
  echo "Watching $ID. Switched-on paddles join by themselves; press BID to start."
  watch_lot "$ID"
  next_or_stop "$ID"
done
