#!/bin/sh
# Bid3 backend entrypoint (used by backend/Dockerfile).
# Always runs the engine. Runs the Arkiv worker beside it only when ARKIV_PRIVATE_KEY is set.
set -eu

export PORT="${PORT:-10000}"

# The laptop's live publisher wallet. A second worker writing with the same key would race the laptop
# worker for nonces and put this backend's test lots among the live site's verified results, so the
# worker refuses that key. Use a separate wallet for this backend.
LIVE_PUBLISHER_ADDRESS="${LIVE_PUBLISHER_ADDRESS:-0xCf11CEa33b48A48901DD2a03730524a69E64e32d}"

start_worker() {
  cd /app/arkiv-worker
  address=$(node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; console.log(privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY).address)" 2>/dev/null || true)
  if [ -z "$address" ]; then
    echo "backend: ARKIV_PRIVATE_KEY isn't a valid 0x-prefixed private key, so the Arkiv worker is OFF." >&2
    return
  fi
  if [ "$(printf %s "$address" | tr 'A-F' 'a-f')" = "$(printf %s "$LIVE_PUBLISHER_ADDRESS" | tr 'A-F' 'a-f')" ]; then
    echo "backend: ARKIV_PRIVATE_KEY is the laptop's live publisher ($address). The Arkiv worker is OFF; use a separate wallet." >&2
    return
  fi
  echo "backend: starting the Arkiv worker as $address against http://127.0.0.1:${PORT}"
  (
    # The worker always talks to the engine in this container, whatever ENGINE_URL says.
    export ENGINE_URL="http://127.0.0.1:${PORT}"
    sleep 3 # let uvicorn start listening first (the worker retries anyway)
    while :; do
      node node_modules/tsx/dist/cli.mjs src/index.ts || true
      echo "backend: the Arkiv worker stopped; restarting in 5 s" >&2
      sleep 5
    done
  ) &
}

if [ -n "${ARKIV_PRIVATE_KEY:-}" ]; then
  (start_worker)
else
  echo "backend: ARKIV_PRIVATE_KEY is not set, so the Arkiv worker is off (records wait in the engine's outbox)."
fi

cd /app/engine
exec python -m bid3_engine
