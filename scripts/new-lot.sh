#!/usr/bin/env bash
# Start a new Bid3 round on the local engine, pointed at the gateway:
#   1. list lot N on Arkiv (ItemListing lot-00N, owned by the publisher wallet)
#   2. create auction bid3-00N from the firmware template (enrolled paddle keys, 10 s countdown)
#   3. open it, so the gateway's presses go to it
#
#   scripts/new-lot.sh                           next free lot number (one above the highest bid3-NNN the engine has)
#   scripts/new-lot.sh <lot number>              a specific number, e.g. scripts/new-lot.sh 7
#   NO_LISTING=1 scripts/new-lot.sh              skip step 1 (practice rounds)
#   TIME_LIMIT_MS=600000 scripts/new-lot.sh      close UNSOLD after 10 min without a bid (default 30 min)
#
# Needs: the engine on :8010 started from engine/.env, the Arkiv worker running with the
# current publisher key in arkiv-worker/.env, and jq. An auction ID can only be used once.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${ENGINE:-http://localhost:8010}"
TIME_LIMIT_MS="${TIME_LIMIT_MS:-1800000}"
ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' "$ROOT/engine/.env" | cut -d= -f2-)
[ -n "$ADMIN_TOKEN" ] || { echo "no ADMIN_TOKEN in engine/.env" >&2; exit 1; }

curl -fsS "$ENGINE/health" >/dev/null || { echo "engine not reachable at $ENGINE" >&2; exit 1; }

N="${1:-}"
if [ -z "$N" ]; then
  LAST=$(curl -fsS "$ENGINE/auctions" \
    | jq -r '(if type == "array" then . else .auctions end)[] | (.state // .) | .auctionId' \
    | sed -nE 's/^bid3-0*([0-9]+)$/\1/p' | sort -n | tail -1)
  N=$(( ${LAST:-0} + 1 ))
  echo "Next free lot number: $N"
fi
if ! [[ "$N" =~ ^[0-9]+$ ]] || (( 10#$N < 1 || 10#$N > 999 )); then
  echo "usage: scripts/new-lot.sh [lot number 1-999]" >&2
  exit 1
fi
N=$((10#$N))
ID=$(printf 'bid3-%03d' "$N")
LISTING=$(printf 'lot-%03d' "$N")
if curl -fsS "$ENGINE/auctions/$ID" >/dev/null 2>&1; then
  echo "$ID already exists on the engine. Auction IDs are single-use: pick another lot number." >&2
  exit 1
fi

if [ "${NO_LISTING:-0}" != "1" ]; then
  echo "1/3 Listing $LISTING on Arkiv"
  (cd "$ROOT/arkiv-worker" && npm run -s seed-listings -- "$N")
else
  echo "1/3 Skipped the Arkiv listing (NO_LISTING=1)"
fi

echo "2/3 Creating $ID"
jq --arg id "$ID" --arg listing "$LISTING" --argjson limit "$TIME_LIMIT_MS" \
  '.auctionId = $id | .listingId = $listing | .rules.timeLimitMs = $limit' \
  "$ROOT/firmware/integration/auction-template.json" \
  | curl -fsS -X POST "$ENGINE/auctions" -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'content-type: application/json' --data @- >/dev/null

echo "3/3 Opening $ID (gateway presses go here now)"
curl -fsS -X POST "$ENGINE/auctions/$ID/open" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null

curl -fsS "$ENGINE/health"
echo
echo "Switch the paddles on. If nobody bids within $((TIME_LIMIT_MS / 60000)) min, $ID closes UNSOLD."
