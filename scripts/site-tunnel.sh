#!/usr/bin/env bash
# Puts the laptop's website (localhost:3000) on the internet so a phone that taps a paddle's NFC sticker
# (https://<host>/seat/K7) reaches it from any network. The engine comes along at https://<host>/engine
# (the site passes that path through), so this is the only tunnel the phones need.
#
#   scripts/site-tunnel.sh quick    now, no account: a Cloudflare quick tunnel (https://<random>.trycloudflare.com).
#                                   Same URL until a reboot or `stop`; after that, rewrite the stickers.
#   scripts/site-tunnel.sh          your own domain (named tunnel): the URL never changes, stickers are written once.
#                                   One-time setup (needs a domain on your Cloudflare account):
#                                     cloudflared tunnel login                        (opens the browser: pick the domain)
#                                     scripts/site-tunnel.sh setup bid3.example.com
#   scripts/site-tunnel.sh stop     stop both
#
# Both run in the background, outside any terminal (logs: ~/Library/Logs/bid3-site-*.log).
# The quick tunnel in scripts/tunnel.sh is separate: it only keeps bid3.vercel.app's read-only view alive.
set -euo pipefail

NAME="bid3-site"
CONF="$HOME/.cloudflared/$NAME.yml"
NAMED_LOG="$HOME/Library/Logs/bid3-site-named.log"
QUICK_LOG="$HOME/Library/Logs/bid3-site-quick.log"
NAMED_PATTERN="cloudflared tunnel --config $CONF"
QUICK_METRICS="127.0.0.1:20301"
QUICK_PATTERN="cloudflared tunnel --metrics $QUICK_METRICS"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

command -v cloudflared >/dev/null || { echo "cloudflared isn't installed: brew install cloudflared" >&2; exit 1; }
env_value() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | head -1 | cut -d= -f2-; }

# Everything in a NEXT_PUBLIC_ variable is sent to every visitor. Never publish the worker's Arkiv key.
refuse_leaky_site() {
  local site_key worker_key
  site_key=$(env_value "$ROOT/web/.env.local" NEXT_PUBLIC_ARKIV_ACCESS_KEY)
  worker_key=$(env_value "$ROOT/arkiv-worker/.env" ARKIV_ACCESS_KEY)
  if [ -n "$site_key" ] && [ "$site_key" = "$worker_key" ]; then
    echo "Not starting: web/.env.local's NEXT_PUBLIC_ARKIV_ACCESS_KEY is the worker's key, and a public site sends it to every visitor." >&2
    echo "Leave it empty and set NEXT_PUBLIC_ARKIV_RPC_PATH=/api/arkiv-rpc + ARKIV_RPC_URL (reads go through the site), then rebuild." >&2
    exit 1
  fi
  curl -fsS -m 3 -o /dev/null http://localhost:3000/ || echo "⚠️  The site isn't answering on localhost:3000. Start it: cd web && npm run build && npm start"
}

# Waits until the site and the engine answer through https://$1, then prints the sticker URLs.
check_public() {
  local host="$1"
  echo "Site: https://$host"
  echo "Checking it answers (a new tunnel can take up to 90 s)…"
  for _ in $(seq 1 45); do
    if curl -fsS -m 5 -o /dev/null "https://$host/engine/health" 2>/dev/null; then
      echo "✅ https://$host is up and reaches the engine."
      echo "   NFC stickers (NDEF URL record): https://$host/seat/K7  and  https://$host/seat/M4"
      echo "   Admin: https://$host/admin"
      return 0
    fi
    sleep 2
  done
  echo "❌ https://$host/engine/health didn't answer within 90 s. Check the site (:3000), the engine (:8010) and the log." >&2
  return 1
}

case "${1:-start}" in
  quick)
    refuse_leaky_site
    if pgrep -f "$QUICK_PATTERN" >/dev/null; then
      echo "Quick site tunnel already running in the background."
    else
      mkdir -p "$(dirname "$QUICK_LOG")"
      nohup cloudflared tunnel --metrics "$QUICK_METRICS" --url http://localhost:3000 >>"$QUICK_LOG" 2>&1 </dev/null &
      disown
      echo "Started a quick site tunnel in the background (log: $QUICK_LOG)."
    fi
    host=""
    for _ in $(seq 1 30); do
      host=$({ curl -fsS -m 3 "http://$QUICK_METRICS/quicktunnel" 2>/dev/null || true; } | sed -nE 's/.*"hostname":"([^"]+)".*/\1/p')
      [ -n "$host" ] && break
      sleep 1
    done
    [ -n "$host" ] || { echo "The quick tunnel didn't report a URL within 30 s. See $QUICK_LOG" >&2; exit 1; }
    check_public "$host"
    ;;

  setup)
    host="${2:?usage: scripts/site-tunnel.sh setup <hostname on your Cloudflare domain, e.g. bid3.example.com>}"
    [ -f "$HOME/.cloudflared/cert.pem" ] || { echo "Run 'cloudflared tunnel login' first and pick the domain that $host is on." >&2; exit 1; }
    cloudflared tunnel info "$NAME" >/dev/null 2>&1 || cloudflared tunnel create "$NAME"
    id=$(cloudflared tunnel list --output json | python3 -c 'import json,sys; print(next(t["id"] for t in json.load(sys.stdin) if t["name"] == sys.argv[1]))' "$NAME")
    cloudflared tunnel route dns --overwrite-dns "$NAME" "$host"
    mkdir -p "$(dirname "$CONF")"
    cat >"$CONF" <<EOF
tunnel: $id
credentials-file: $HOME/.cloudflared/$id.json
ingress:
  - hostname: $host
    service: http://localhost:3000
  - service: http_status:404
EOF
    cloudflared tunnel --config "$CONF" ingress validate
    echo "Set up: https://$host -> the site on localhost:3000. Start it with: scripts/site-tunnel.sh"
    ;;

  start)
    [ -f "$CONF" ] || { echo "Your domain isn't set up yet (see the top of this script). For now: scripts/site-tunnel.sh quick" >&2; exit 1; }
    refuse_leaky_site
    if pgrep -f "$NAMED_PATTERN" >/dev/null; then
      echo "Site tunnel already running in the background."
    else
      mkdir -p "$(dirname "$NAMED_LOG")"
      nohup cloudflared tunnel --config "$CONF" --metrics 127.0.0.1:20300 run "$NAME" >>"$NAMED_LOG" 2>&1 </dev/null &
      disown
      echo "Started the site tunnel in the background (log: $NAMED_LOG)."
    fi
    check_public "$(sed -nE 's/^ *- hostname: *//p' "$CONF" | head -1)"
    ;;

  stop)
    stopped=0
    pkill -f "$NAMED_PATTERN" && stopped=1 || true
    pkill -f "$QUICK_PATTERN" && stopped=1 || true
    if [ "$stopped" = 1 ]; then echo "Site tunnel stopped."; else echo "No site tunnel was running."; fi
    ;;

  *)
    echo "usage: scripts/site-tunnel.sh [quick | start | setup <hostname> | stop]" >&2
    exit 2
    ;;
esac
