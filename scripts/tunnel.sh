#!/usr/bin/env bash
# Keep one Cloudflare quick tunnel to the local engine (:8010) running in the background, outside any
# terminal, so closing VS Code terminals never changes the public URL. Only a reboot or `stop` does.
# The gateway never uses this: the bridge talks to the engine over localhost. The tunnel exists only
# so the Vercel site can reach the engine.
#
#   scripts/tunnel.sh          start it if needed, print its URL, and say whether the site uses it
#   scripts/tunnel.sh stop     stop it (the next start gets a NEW URL, and Vercel needs updating)
#
# Log: ~/Library/Logs/bid3-tunnel.log. Override the site to check with SITE=https://…
set -euo pipefail

METRICS="127.0.0.1:20299"
PATTERN="cloudflared tunnel --metrics $METRICS"
LOG="$HOME/Library/Logs/bid3-tunnel.log"
SITE="${SITE:-https://bid3.vercel.app}"

hostname_now() { { curl -fsS -m 3 "http://$METRICS/quicktunnel" 2>/dev/null || true; } | sed -nE 's/.*"hostname":"([^"]+)".*/\1/p'; }

if [ "${1:-}" = "stop" ]; then
  if pkill -f "$PATTERN"; then echo "Tunnel stopped. The next start gets a new URL."; else echo "No background tunnel was running."; fi
  exit 0
fi

command -v cloudflared >/dev/null || { echo "cloudflared isn't installed: brew install cloudflared" >&2; exit 1; }

if pgrep -f "$PATTERN" >/dev/null; then
  echo "Tunnel already running in the background."
else
  echo "Starting the tunnel in the background (log: $LOG)…"
  mkdir -p "$(dirname "$LOG")"
  nohup cloudflared tunnel --metrics "$METRICS" --url http://localhost:8010 >>"$LOG" 2>&1 </dev/null &
  disown
fi

HOST=""
for _ in $(seq 1 30); do
  HOST=$(hostname_now)
  [ -n "$HOST" ] && break
  sleep 1
done
[ -n "$HOST" ] || { echo "The tunnel didn't report a URL within 30 s. See $LOG" >&2; exit 1; }

echo
echo "  Tunnel:              https://$HOST"
echo "  Vercel needs:        NEXT_PUBLIC_ENGINE_WS_URL=wss://$HOST"
echo "                       (and NO NEXT_PUBLIC_ENGINE_HTTP_URL: the site works it out from the WS URL)"
echo

# A new tunnel can take a minute or so before it answers.
REACHABLE=0
curl -fsS -m 5 -o /dev/null "https://$HOST/health" 2>/dev/null || echo "  (checking the engine through the tunnel; a new tunnel can take up to 90 s…)"
for _ in $(seq 1 45); do
  if curl -fsS -m 5 -o /dev/null "https://$HOST/health" 2>/dev/null; then REACHABLE=1; break; fi
  sleep 2
done
if [ "$REACHABLE" = 1 ]; then
  echo "  Engine:              ✅ reachable through the tunnel"
elif curl -fsS -m 3 -o /dev/null http://localhost:8010/health 2>/dev/null; then
  echo "  Engine:              runs locally but isn't reachable through the tunnel yet. Rerun this script in a minute."
else
  echo "  Engine:              ❌ not running on :8010. Start it in the engine terminal; the tunnel URL stays the same."
fi

# Which tunnel is built into the live site? NEXT_PUBLIC_* values are baked in at build time.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if curl -fsS -m 15 "$SITE" -o "$TMP/index.html"; then
  for chunk in $(grep -oE '_next/static/[^"\\ ]+\.js' "$TMP/index.html" | sort -u); do
    curl -fsS -m 10 "$SITE/$chunk" 2>/dev/null || true
    echo
  done > "$TMP/all.js"
  WS=$(grep -oE 'wss://[a-z0-9-]+\.trycloudflare\.com' "$TMP/all.js" | sort -u | paste -sd ' ' - || true)
  # With NEXT_PUBLIC_ENGINE_HTTP_URL unset, the bundle holds only the wss:// URL, never an https:// tunnel URL.
  HTTP=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TMP/all.js" | sort -u | paste -sd ' ' - || true)
  if [ "$WS" = "wss://$HOST" ] && [ -z "$HTTP" ]; then
    echo "  $SITE:  ✅ already uses this tunnel. Nothing to do in Vercel."
  else
    echo "  $SITE:  ❌ built with: ${WS:-no tunnel URL}${HTTP:+ and an HTTP URL $HTTP}"
    echo "  → In Vercel set NEXT_PUBLIC_ENGINE_WS_URL=wss://$HOST, delete NEXT_PUBLIC_ENGINE_HTTP_URL, then Redeploy."
  fi
else
  echo "  Couldn't load $SITE to check which tunnel it uses."
fi
