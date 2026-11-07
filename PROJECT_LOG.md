# Bid3 project log

Shared memory for every person and AI assistant working on this repo. **Read this before changing anything, and add an entry to the changelog at the bottom after every change.** Newest entries go at the top of the changelog. Keep entries factual: what changed, where, why, and what's still open.

---

## 1. What Bid3 is

A live auction run with physical paddle tags, built for **ETHGlobal Mumbai (Nov 2026)**, with **Arkiv** as the only sponsor integration.

- Each bidder holds an ESP32 tag with a **slide switch** and a **BID button**.
- **Switch ON** joins the room and **switch OFF** leaves (the bidder stays eligible to come back).
- **Press BID** to bid the next price. Each accepted bid adds **5%** (exact integer maths) and restarts a short **hammer countdown** ("going once, going twice, sold").
- When the countdown ends, the **leader wins**. The leader switching off doesn't withdraw their bid.
- A tag-specific fault blocks only that bidder; healthy bidders continue. Gateway/bridge/engine-wide outages **pause** the room. Accepted bids remain binding after OFF or a tag fault.
- Every listing, bid and result is a public **Arkiv entity**, readable without our server. Payment is simulated (demo credits).

## 2. Key decisions (don't reverse without telling the team)

| Decision | Choice | Where it lives |
|---|---|---|
| Name | **Bid3** (was HoldBid) | everywhere |
| Sponsor | **Arkiv only** (one Arkiv track prize + optional Swarm bonus) | `arkiv/` |
| Track | **Build on Arkiv (from scratch)** (Kev, Fri 6 Nov ~19:30). Requires ETHGlobal's Classic rules: no pre-existing project-specific code; see the changelog entry "track and rules" | `README.md`, `arkiv/` |
| Button | **Press = bid at the next step** (not a jump bid on a running clock) | engine `auction.py` |
| Who opens bidding | **The auctioneer**, on one lot at a time, from the website's `/admin` page (password). Bidding is open at once; no minimum number of paddles; any seated paddle can join at any time and bid. A **lone bidder wins** at their bid. A **no-bid timer** (1/2/5/10 min, chosen by the auctioneer) runs from opening; with no bid the lot closes UNSOLD and goes back to the seller (Kev, Sat 7 Nov ~02:15) | engine `auction.py`, `web/src/app/admin/` |
| Leader switches OFF | **Bid stays binding**; they can still win | engine `auction.py` |
| Payment | **The winning paddle's wallet pays the seller on Sepolia.** Tapping the paddle's NFC sticker opens `/seat/<alias>` in the phone's browser, which has its own **phone wallet** (a Sepolia key kept in that browser); one tap links it to the paddle, and **after the hammer it pays the seller automatically**. MetaMask is a fallback (unreliable on phones, Sat 7 Nov ~06:20). The rate is **0 ETH per credit** (only gas), editable on `/admin`. If the winner doesn't pay within 10 min (or has no wallet, or the lot has no seller wallet), **the lot stays with the seller**. Paddles without a wallet can still bid. Off unless the engine has `PAYMENTS=1` (Kev, Sat 7 Nov ~04:30) | engine `payments.py`, `web/src/lib/payments*.ts` |
| Step | **+5% per bid** (500 bps), configurable per auction | rules |
| Countdown | V6 hardware rounds use 10 s via published countdownMs=10000; unchanged engine seed defaults to 5 s unless SEED_COUNTDOWN_MS=10000 | auction rules / engine env |
| Stale presses | A press whose `stateVersion` predates the latest bid is refused as `STALE` | engine + firmware |
| Frontend | Next.js 16 on Vercel | `web/` |
| Backend | FastAPI engine + Python bridge on the laptop + TypeScript Arkiv worker | `engine/`, `bridge/`, `arkiv-worker/` |
| Hosting | Vercel (web). Engine, worker and bridge run on Kev's laptop; the engine is public through a Cloudflare quick tunnel (Railway trial expired; Kev, Fri 6 Nov ~22:15) | READMEs (still say Railway), changelog "hosting moved to the laptop" |
| Firmware | Arduino C++ for the tags and gateway, on branch **`firmware`** (not on `main`) | `origin/firmware` |
| Commits | **Only Kev commits.** AI assistants write files but never run `git commit` or `git push` | — |

Event timing: submission deadline is **Sat 7 Nov 2026, 09:00 IST**, confirmed on ETHGlobal's Mumbai rules page. Late submissions are not accepted. The plan targets submitting by 07:00. Hardware cut-off: if the real-hardware round isn't working by 01:00, demo with the keyboard bridge (labelled) and show the hardware separately.

## 3. Repo layout

```
web/            Next.js frontend (room, lots, bid history, results explorer, seller flow, seat page)
engine/         FastAPI auction engine: single authority for order, price, countdown, winner
bridge/         Laptop program: gateway USB serial <-> engine WebSocket (+ fake gateway for tests)
arkiv-worker/   Drains the engine outbox into Arkiv entities with the publisher wallet
arkiv/          Arkiv prize write-ups (schema.md done; friction, reach, why-arkiv, how-you-use-arkiv to do)
firmware/       V6 Arduino tag/gateway sources, wiring/protocol docs and hardware validation (firmware branch)
backend/        Standalone deploy (Render): Dockerfile built from the repo root that runs engine/ (+ optional arkiv-worker/); no code of its own
PROJECT_LOG.md  This file
AGENTS.md       Pointer for AI tools: read this log first
```

**Branches**
- `main`: web, engine, bridge, arkiv-worker, arkiv docs, this log.
- `firmware`: V6 Arduino C++ sources in `firmware/`, rebuilt from the owner-tested working BLE archive. The canonical `bridge/` now matches the AUCTION serial contract at 115200 baud. V2, V4 and V5 are retained in Git history. See `firmware/README.md` for scope and remaining bench acceptance.

**Who works where:** each component may be handled by a separate AI chat in the Claude Project "EthGlobal Hackathon" (engine, bridge, arkiv-worker, web, firmware). Every chat reads this log first, works only in its own folder or branch, changes a contract in section 4 only together with the other side, and adds a changelog entry here.

Planning documents (outside the repo): `/Users/kev/Hackathons/EthGlobal/Plans/`. These are `Bid3_Architecture_v2_2026-11-06.md`, `Bid3_Quick_Brief_v2_2026-11-06.md` and `understanding.md`. They predate the BID-button decision; where they disagree with this log, this log wins.

## 4. Contracts between the pieces (change both sides together)

| Contract | Defined in | Must match |
|---|---|---|
| Live stream messages (`snapshot`, `state`, `bid`) and `AuctionState` | `web/src/lib/types.ts` | `engine/bid3_engine/auction.py` (`state()`) |
| Exact pricing `price(n) = min(ceiling, round_half_up(start × (10000+bps)^n / 10000^n))` | `web/src/lib/pricing.ts` | `engine/bid3_engine/pricing.py` |
| Rules hash (sha256 of canonical JSON, fixed key order) | `web/src/lib/rules-hash.ts` | `engine/bid3_engine/rules_hash.py` |
| Transcript digest (sha256 of bids sorted by `bidIndex`, sorted keys, non-ASCII escaped like Python's `json.dumps`) | `web/src/lib/transcript-digest.ts` | `engine/bid3_engine/auction.py` (`transcript_digest`) |
| Arkiv entity schemas (6 types, incl. `AuctionSettlement`) | `web/src/lib/arkiv/schemas.ts` | `arkiv-worker/src/schemas.ts` (identical copy) |
| Serial protocol (115200; AUCTION_EVENT/STATE/ACK_JSON, session-correlated ACKs, AUCTION_STATUS/BRIDGE_JSON, CMD=STATUS) | `bridge/README.md` | gateway firmware |
| Outbox (`GET /outbox`, `POST /outbox/{id}/published`) | `engine/bid3_engine/api.py` | `arkiv-worker/src/index.ts` |
| Public lot list `GET /auctions` (auctionId, listingId, phase, priceMinor, bidCount, leaderAlias, payment) | `engine/bid3_engine/api.py` | `web/src/lib/lot-state.ts` (`EngineLot`) |
| Admin calls (`POST /auctions`, `/open`, `/cancel` with `ADMIN_TOKEN`; house rules 5% / 10 s / ceiling 10× opening) | `engine/bid3_engine/api.py` | `web/src/lib/admin/server.ts` |
| Payments API (`GET /bindings`, `/payments`, `/payments/settings`, `/auctions/{id}/payment`; admin `POST /bindings`, `/bindings/{alias}/clear`, `/payments/settings`, `/auctions/{id}/payment/paid`; `sellerAddress` on `POST /auctions`) | `engine/bid3_engine/api.py`, `payments.py` | `web/src/lib/payments-shared.ts` (`Payment`, `Binding`), `payments.ts`, `payments-server.ts`, `lib/admin/server.ts` |
| Settlement outbox record (`AuctionSettlement`, logical id `settlement:<auctionId>:<epoch>`) | `engine/bid3_engine/payments.py` (`settlement_record`) | `arkiv-worker/src/writer.ts` |
| Paddle roster (tagRef, alias, publicKey per seat) | `firmware/integration/auction-template.json` | `web/src/lib/admin/paddles.ts`. Check: `jq -c '[.seats[] \| {tagRef, alias, publicKey}]' firmware/integration/auction-template.json` and compare |

V6 firmware retains the V4 AUCTION serial contract and remains compatible with the existing bridge. Each JOIN/LEAVE/BID is signed using the existing engine Bid3.Intent.v1 format; enable INTENT_SIGNATURES_REQUIRED and enroll the seat public keys. The engine remains the sole auction authority. V6 templates use a 10-second countdown; existing frozen auctions and the engine's 5-second seed default are not changed silently. V1 signatures do not include auctionId/epoch: one active lot and drained pending requests are required before switching lots. Cross-round replay protection remains a coordinated engine-contract follow-up.

Checks that catch drift:

- `cd engine && python -m pytest`: the vectors are generated from the TypeScript. Regenerate them with `node --experimental-strip-types engine/scripts/make_vectors.mjs`, run from the repo root.
- `cd arkiv-worker && npm run check-schemas`

## 5. How to run everything locally

**Live setup (Kev's laptop, current).** Open four VS Code terminals and rename each one (right-click → Rename). Start them in this order:

| Terminal | Command | Ready when |
|---|---|---|
| `engine` | `cd engine && set -a && source .env && set +a && caffeinate -i .venv/bin/python -m bid3_engine` | `Uvicorn running on http://0.0.0.0:8010` |
| `worker` | `cd arkiv-worker && npm start` | `Writing to Arkiv as 0xCf11CEa33b48A48901DD2a03730524a69E64e32d` |
| `bridge` | `cd bridge && set -a && source ../engine/.env && set +a && ../engine/.venv/bin/python bid3_bridge.py --port /dev/cu.usbserial-<n> --engine ws://localhost:8010 --token "$BRIDGE_TOKEN"` | `/health` shows `bridgeConnected: true` |
| `ops` | `scripts/tunnel.sh` (once). Then run lots from **`https://bid3.vercel.app/admin`** ("Open bidding" per lot). Fallbacks: `scripts/new-lot.sh` / `scripts/auto-rounds.sh` (create their own keyboard listing, no admin) | the tunnel script prints ✅ for the engine and the site |

**Admin page:** needs two **server** env vars in Vercel, both type Secret and without the `NEXT_PUBLIC_` prefix: `ADMIN_TOKEN` (the same value as in `engine/.env`) and `ADMIN_PASSWORD` (Kev's choice). The browser sends the password to `/api/admin/*`; the server calls the engine through the tunnel with the token. The demo catalogue is `npm run seed-catalogue` in `arkiv-worker` (six items, lots 11–16, `bid3-cat-NN`; safe to rerun).

**Payments on Sepolia:** add `PAYMENTS=1` to `engine/.env`, then restart the **engine and the worker together** (an older worker can't write `AuctionSettlement` and would hold up the outbox). No new Vercel env vars: the payment routes use `ADMIN_TOKEN`; `SEPOLIA_RPC_URL` is optional. Write `https://bid3.vercel.app/seat/K7` (and `…/M4`) onto each paddle's NFC sticker: the tap opens the seat page in the phone's normal browser. Each phone's wallet (address shown on the seat page, with a Copy button) needs a little Sepolia ETH for gas, sent once from any wallet or the faucet. The same browser keeps the same wallet; another browser or cleared site data makes a new one. Lots pay the listing's seller wallet (the demo catalogue's is the publisher wallet); only lots started from `/admin` after this change carry it, so lots from `new-lot.sh`/`auto-rounds.sh` end UNPAID.

**Tunnel:** `scripts/tunnel.sh` runs `cloudflared` in the background, outside any terminal (log: `~/Library/Logs/bid3-tunnel.log`).
- Closing terminals or restarting the engine, worker or bridge doesn't change its URL. Only a reboot or `scripts/tunnel.sh stop` does.
- Each run prints the current URL and checks whether `bid3.vercel.app` is built with it. If not, set Vercel's `NEXT_PUBLIC_ENGINE_WS_URL=wss://…` and redeploy.
- Leave `NEXT_PUBLIC_ENGINE_HTTP_URL` unset: the site works it out from the WS URL.
- The gateway never uses the tunnel.

**Dev from scratch:**

```bash
# engine (seeds and opens auction bid3-003 with paddles TAG1->K7, TAG2->M4)
cd engine && pip install -r requirements-dev.txt && python -m bid3_engine     # :8010 (8000 is taken on Kev's Mac)

# bridge: real gateway, keyboard, or fake gateway
cd bridge && pip install -r requirements.txt
python bid3_bridge.py --port /dev/cu.usbserial-XXXX     # or --keyboard

# web in live mode
cd web && echo "NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:8010" > .env.local && npm install && npm run dev   # :3000

# arkiv worker (dry until ARKIV_PRIVATE_KEY is set)
cd arkiv-worker && npm install && ENGINE_URL=http://localhost:8010 npm start
```

With no env, the web app runs a labelled in-browser simulation and bundled sample Arkiv data. Every surface shows its data source (Live, Simulation, From Arkiv, Sample data).

## 6. Status and open items

**Done**

- Hardware: both tags connect to the gateway; button presses reach the gateway (test counter). _As of Fri 09:18._
- Frontend: built and committed (`1870e89`).
- Backend: engine, bridge and worker built; full round tested end to end with the fake gateway.

**Open, roughly in priority order**

1. **V4 firmware/bridge follow-up** (branch `firmware`): source/serial/canonical-signature alignment is implemented. Verify real hardware and enable required enrolled signatures on the deployed engine. Keep one active auction and drain outstanding intents before changing it; round-bound signatures remain future coordinated work.
2. **Real-hardware round:** run engine + bridge + web against the real gateway; measure press-to-ack latency and confirm the countdown length.
3. **Arkiv:**
   - Create and fund the publisher wallet; get an access key.
   - Run the worker live and run `npm run seed-listings`.
   - Set `NEXT_PUBLIC_ARKIV_MODE=live`, `NEXT_PUBLIC_ARKIV_ACCESS_KEY` and `NEXT_PUBLIC_PUBLISHER_ADDRESS` in web.
   - Confirm the explorer entity URL format in `web/src/lib/config.ts` (`explorerEntityUrl`).
4. **Deploy:** Vercel (`web`, root dir `web`). Engine and worker run on the laptop, with the engine behind `cloudflared tunnel --url http://localhost:8010`. Point Vercel's engine URLs at the tunnel, and redeploy whenever the tunnel URL changes.
5. **Arkiv write-ups:**
   - `arkiv/friction.md`: log snags as they happen, with time, expected, actual and repro.
   - `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.
   - Writer wallet addresses and a runnable query in the README.
6. **Web placeholders:** the seller's "Open the round" and listing IDs need wiring to the engine's `POST /auctions` and `/open`; the seller sign-in is not built yet.
7. **Submission:**
   - Root README states that all code, firmware included, was written at Mumbai (Kev, Fri 6 Nov), and lists what was reused: public libraries, the Adafruit 5×7 font, off-the-shelf ESP32 boards.
   - It must also include measured latency and say how AI was used.
   - Demo video, 3 minutes or less, with no AI voiceover.

## 7. Rules for assistants

- Read this file first. Append a changelog entry after your change, newest first.
- Never commit or push; Kev does that.
- Never put private keys in `NEXT_PUBLIC_*` vars or in the repo. The publisher key lives only in the worker's environment.
- If you change a contract in section 4, change both sides in the same session and run the drift checks.
- Keep the engine as the only authority: browsers never decide a winner, and nothing on Arkiv sits in the live bid loop.
- Label anything simulated as simulated.

---

## Changelog

### 2026-11-07 ~06:50 IST: "No bidding is going on right now" instead of an old lot
- **Ask (Kev):** with no auction running, the watch room showed the previous lot's data. It should say no bidding is going on.
- **Cause:** every "Live room" link went to `/room/<engine's activeAuctionId>`. The engine keeps the last-opened lot as active after it closes, and after a restart there's none, so the site fell back to the build-time `bid3-003`.
- **Change (web only):**
  - New `/room` page (`app/room/page.tsx`, `live-room.tsx`) behind the header, home-page and paddle-page links.
    - It shows the lot open right now (`lib/use-live-lot.ts`: a lot counts as live only in LOBBY/OPEN/COUNTDOWN/PAUSED, from `GET /auctions`).
    - With none open it shows "No bidding is going on right now" (or "Room offline" when the engine can't be reached), with links to Lots and Results. It switches to the next lot by itself when bidding opens.
    - A lot that was on screen stays through the hammer (result and payment), then follows the next one. The address bar stays `/room`.
  - `/room/<lot>` (from Results, bid history and lot cards) still shows that lot. A closed one now says "Bidding on this lot has ended. No bidding is going on right now", with a link to the Live room.
  - Paddle page: with no lot in the engine it says "No bidding is going on right now" instead of showing `bid3-003`. A lot that just closed stays, so the winner sees "You won" and the payment, plus a note that bidding has ended. "Open the big screen" goes to `/room`, which also removes the old hydration warning on that link.
- **Tested** in headless Chrome against a scratch engine, every case as expected:
  - `/room` with nothing running shows the idle message, and the header link is `/room`.
  - A lot opened while the page was open showed without a refresh.
  - After the hammer the result stayed, with the "no bidding" note.
  - Reloading `/room` afterwards shows the idle message.
  - `/room/<closed lot>` shows the note.
  - The paddle page shows the ended note on a closed lot, and "No bidding is going on right now" with an empty engine.
  - The next lot opening on `/room` was followed.
  - No page exceptions; `tsc`, `eslint` and `next build` clean.

### 2026-11-07 ~06:35 IST: standalone backend for Render (`backend/`)
- **Ask (Kev):** the judges need a standalone hosted backend, and Kev plans to use Render. Everything else must keep working as it is.
- **New `backend/`, deployment files only:**
  - `Dockerfile`: built from the repo root; it copies `engine/` and `arkiv-worker/` as they are. There's one copy of the code, so section 4 can't drift.
  - `start.sh`, `render.yaml` (Blueprint path `backend/render.yaml`), `.env.example`, `Dockerfile.dockerignore`, `.gitignore`.
  - `README.md`: deploy steps, env vars, limits.
- **Behaviour:**
  - The engine always runs.
  - The Arkiv worker runs in the same container only when `ARKIV_PRIVATE_KEY` is set.
  - It refuses the laptop's publisher key (`0xCf11…e32d`). Two workers on one key would race for nonces and put Render's test lots among the live site's verified results.
  - `REQUIRE_TOKENS=1` comes from the image env, so `config.py` (whose default only detects Railway) is unchanged.
- **Nothing existing changed** except this log (one line in section 3). Vercel stays pointed at the laptop, so the live path is untouched.
- **Tested locally in Docker** (port 8097; the live engine on 8010 was left alone and still answers):
  - The image builds and contains no `.env`. With no tokens, the engine refuses to start.
  - With tokens: `/health` and `/auctions` answer (seeded `bid3-003`); the CORS preflight passes for `bid3.vercel.app`; `/outbox` gives 401 without the token and 200 with it.
  - The keyboard bridge connected over WS (token redacted in the logs) and ran a round: 2 bids, M4 leading, COUNTDOWN.
  - The worker ran with a throwaway unfunded key and an empty outbox, and polled the in-container engine. Nothing was written to Arkiv.
  - The publisher-key guard and an invalid key both leave the worker off and the engine up.
  - Engine `pytest`: 60 passed. `check-schemas`: match.
- **Not tested:** a real Render deploy (the Blueprint path, the build on Render, the free plan's spin-down), and the worker writing to Arkiv from the container.
- **Open:**
  - Kev: create the Render service and set the env vars.
  - Optionally put the Render URL in the root README for the judges.
  - The free plan sleeps after 15 min and wipes SQLite on every restart (why the ~22:15 entry moved hosting to the laptop).

### 2026-11-07 ~06:30 IST: phone wallet on the seat page (MetaMask out of the bidder's path)
- **Seen (Kev, two phones, after a full restart):** in MetaMask's mobile browser, linking failed at once on one phone ("must provide an Ethereum address", -32602) and with "Load failed" after 16 s on the other.
  - The server side was healthy: the tunnel answered in ~0.5 s, `/api/bind` in ~1 s, and K7 had linked at 06:12:50.
  - So these failures happen inside MetaMask Mobile, on top of the Pay now failure at ~06:00.
- **Change:** the seat page now has its own Sepolia wallet (`web/src/lib/phone-wallet.ts`), created in the phone's browser on the first visit and kept in `localStorage`.
  - "Link this phone to Paddle X" signs locally and posts to the same `/api/bind`.
  - When the paddle wins, the page **pays by itself** (same transaction shape, so `/api/pay` and the engine are unchanged).
  - The panel shows the wallet's address, balance and a Copy button, and asks for Sepolia ETH when it's empty.
  - MetaMask stays as a fallback ("Use the wallet app in this browser instead", and "Pay with MetaMask" for a payment linked to another wallet).
- **Hardening:**
  - Site calls retry a dropped connection three times.
  - The payment is signed and stored before it's broadcast. A retry or reload rebroadcasts the same signed transaction (same nonce, so it can only be included once) or confirms it's already on Sepolia. A transaction Sepolia refuses is dropped and re-signed.
  - It's attempted automatically once per lot per page load; "Pay now" retries by hand.
  - Every step goes into the "What happened, step by step" trace.
- **Sticker URL:** now `https://bid3.vercel.app/seat/<alias>`, the plain site, instead of the MetaMask link.
- **Tested in headless Chrome** (phone size, scratch engine, copy of the site):
  - The first visit created a wallet and showed its 0 ETH balance.
  - The link button bound that exact address in the engine through `/api/bind`.
  - A one-paddle round sold, and the payment became DUE from that address.
  - The page tried to pay by itself and stopped with "needs Sepolia ETH" and the trace.
  - A reload kept the same wallet, and there were no page exceptions. `tsc`, `eslint` and `next build` clean.
- **Not tested:** the broadcast with real Sepolia ETH (no funded key here). The first funded run on a phone is the real test.
- **Trade-off:** the key lives in the browser (fine for a testnet demo). Clearing site data loses the wallet and its Sepolia ETH, and Safari, Chrome and MetaMask's browser each get their own wallet.

### 2026-11-07 ~06:05 IST: fix "must provide an Ethereum address" on Pay now (MetaMask Mobile)
- **Seen (Kev, on a phone):** linking M4 worked (wallet `0x5e33…31ca`). Pay now failed with MetaMask's "Invalid parameters: must provide an Ethereum address." The engine had the payment DUE; `/api/pay` was never called and the wallet has sent no transactions on Sepolia.
- **Causes:**
  1. `sendPayment` asked for the account *before* switching to Sepolia. MetaMask Mobile shares accounts with a site per network and gives that misleading error for an account not shared on the current network.
  2. That wallet has 0 Sepolia ETH, so even a 0 ETH payment can't pay its gas.
- **Fix (`web/src/lib/payments.ts`):** switch to Sepolia first, then request the account. Check the Sepolia balance before sending, with a clear "no Sepolia ETH for gas" message (and the faucet link). The MetaMask error now maps to an instruction to approve the connection or reconnect the site.
- **Tracing:** every link or pay attempt records its steps (network before and after, account, balance, send, the site's check). The seat page shows them under an error ("What happened, step by step"), and they're also in the browser console as `[bid3 payment]`.
- **Tested:** `tsc` and `eslint` clean. Against a fake wallet that shares accounts per network and refuses a send on a network it hasn't shared (the reported error): with no gas it stops with the gas message; with gas it switches, gets the account and sends. Not yet retested on the phone.

### 2026-11-07 ~04:55 IST: paddle wallets and Sepolia payments
- **Ask (Kev):** tap a phone on a paddle's NFC tag to link a wallet to that paddle; when the paddle wins, that wallet pays the seller's wallet. Sepolia, 0 ETH (only gas) for now, editable later. Paddles without a wallet still bid. If the winner can't pay, the lot always stays with the seller.
- **Answer given first:** the paddles have no wallets today. Each has a secp256k1 signing key (Ethereum-style addresses K7 `0x9e10…f0D9`, M4 `0x560A…fe70`), used only to sign presses; nothing was paid before this change.
- **Design:** the winner pays from their phone (a plain Sepolia transaction from the linked wallet to the seller, value = hammer × rate, data = `bid3:<auctionId>`). With native ETH a wallet can't be charged without its owner signing, and this needs no contract. Everything is additive and off unless `PAYMENTS=1`.
- **Engine:** new `payments.py`, new tables `bindings`, `payees`, `payments`, `settings`. The runtime creates the payment when a lot turns SOLD_LOCKED and expires DUE payments once a second. New endpoints (section 4); `sellerAddress` is optional on `POST /auctions`; `GET /auctions` items gain `payment`. `auction.py` is unchanged. Settings: `PAYMENTS`, `PAYMENT_WEI_PER_CREDIT`, `PAYMENT_WINDOW_MS` (`engine/.env.example`).
- **Arkiv:** new `AuctionSettlement` entity (`bid3.settlement`) in both `schemas.ts`, written by the worker (`writer.ts`), documented in `arkiv/schema.md`.
- **Web:**
  - `/api/bind` checks the wallet's signature of `bindMessage()` (10-min freshness).
  - `/api/pay` checks the Sepolia transaction (mined, successful, from the payer, to the payee, value ≥ due, memo), then calls the engine.
  - `/api/admin/payments` sets the rate (ETH per credit); `/api/admin/unbind` unlinks a paddle.
  - Seat page: "Paying for Paddle X" panel: link the wallet, then **Pay now** when it won, or "Open in MetaMask" without a wallet in the browser.
  - Room page: payment status with Etherscan links.
  - Lots: a new state `unpaid` ("Not paid", stays with the seller).
  - Admin: "Payments on Sepolia" panel (rate, paddle wallets, unlink). Lots started from `/admin` now pass the listing's seller wallet.
- **Tested:**
  - Engine: 60 passed (11 new in `tests/test_payments.py`, incl. "payments off changes nothing"). Web: `tsc` and `eslint` clean. Worker: `tsc` and `check-schemas` clean.
  - On a scratch engine (port 8099) plus a copy of the site on port 3001:
    - Real signatures linked a wallet. A forged signature, the wrong paddle, a stale signature, an unknown paddle and rebinding a paddle that owes were all refused.
    - A one-paddle round sold, and the payment became DUE with the right payer, payee and 0 wei.
    - `/api/pay` against real Sepolia: an unmined hash answered "pending". A real transfer between exactly those wallets passed the sender, recipient and amount checks and was refused only for lacking the memo.
    - The admin rate set and reset; unlinking while owing was refused.
    - The AuctionSettlement payloads (PAID and UNPAID) pass the Arkiv SDK's schema validation (checked offline; nothing was written).
    - Screenshots of the seat and room pages show the panels.
- **Not tested:** a real MetaMask payment from a phone (needs Sepolia ETH and the NFC stickers), the full PAID path through `/api/pay` (the final engine call is covered by the engine tests), and a real AuctionSettlement write to Arkiv.
- **Open:**
  - The seat page's "Open the big screen" link renders `bid3-003` on the server and the live lot in the browser: a hydration warning that predates this change.
  - A withdrawn or unpaid lot can't be put up again without relisting.
  - Paid-too-late refunds are manual (only possible when the rate is above 0).

### 2026-11-07: integrate current main for the landing-page PR
- The user's PR request authorizes the routine integration commit and branch push. Merged current main into frontend without rewriting history and resolved the sole shared-log conflict by preserving both sets of entries.
- Updated the landing step's opening explanation to match main's existing auctioneer-led rules. No backend implementation edits were authored: engine, bridge, worker and firmware match main. The PR diff is limited to web/ and this log.
- Re-ran ESLint, TypeScript and an isolated optimized production build successfully after integration, including main's admin routes. The pull request targets main; this preparation does not merge the PR.

### 2026-11-07: prepare the landing-page work for origin/frontend
- The user explicitly requested committing and pushing this frontend work to the existing frontend branch, authorizing those actions over the usual Kev-only convention. Started from the current origin/frontend head; no main merge, history rewrite or backend/firmware changes are included.
- Completed the frontend review: corrected the landing-page signal-loss explanation to match the existing isolated-paddle policy, replaced the old browser icon with the approved logo, and documented product-image provenance, OLED export steps and font attribution in web/public/ASSETS.md.
- Validation passed: ESLint, TypeScript, isolated optimized production build, production browser checks at desktop/mobile widths, responsive photo loading, the new icon route and OLED pause/play. The production browser reported no console errors. The local dev server remained running throughout the isolated build.

### 2026-11-07: remove duplicate tag captions
- Removed the yellow TAG01/TAG02/TAG03 captions below the landing-card photos. The IDs remain on each physical label and in image alt text. Frontend-only change.

### 2026-11-07: IDs on the tag photographs
- Positioned TAG01, TAG02 and TAG03 directly over the blank physical label in each landing-page tag photo. The labels scale with the photo container; the existing accessible captions remain below. Frontend-only change.

### 2026-11-07: real tag photographs in the how-it-works cards
- Retouched IMG_5674.jpg as the primary tag photo, with IMG_5667.jpg as the sharp-detail/lighting reference, using the built-in image editing tool. Saved the transparent cutout in web/public/images/tag-cutout.png; originals are preserved. Cleared the old physical TAG02 lettering so separate page captions can identify each card consistently.
- Replaced the three landing-page tag illustrations with the photograph and centred TAG01, TAG02 and TAG03 captions beneath it. Retained the step numbers, titles and explanatory copy. Verified image loading, labels, desktop/mobile layout and no horizontal overflow; TypeScript and page ESLint pass. No backend, firmware, engine, bridge, worker or protocol files changed.
- A downloadable copy and the exact edit prompt are saved under the workspace outputs/product-images folder.

### 2026-11-07: animate the gateway photograph's OLED
- Added web/src/components/gateway-photo.tsx: a precisely positioned 128x64 canvas replaces only the photographed OLED content. The original gateway photo remains intact. Includes a labelled firmware preview, pause/play, reduced-motion still, offscreen/hidden-tab suspension and static-photo fallback.
- Exported 545 original firmware framebuffers at Config::DISPLAY_FPS (25 fps) using the read-only frontend exporter web/scripts/render-gateway-oled.cpp. The 21.8 s loop contains the real startup and three idle scenes, with no fake bidders or bid decisions. Static data and font attribution are in web/public/animations/. Rebuild from web with clang++ -std=c++17 scripts/render-gateway-oled.cpp -o /tmp/bid3-oled-export, then /tmp/bid3-oled-export public/animations/gateway-oled.bin.
- Verified exporter metadata/size, TypeScript, page/component ESLint, desktop and mobile alignment and playback controls. No backend, firmware, engine, bridge, worker or protocol files were changed; the existing firmware renderer was read only.

### 2026-11-07: gateway photo in the landing hero
- Replaced only the landing hero's featured lot card with the owner's edited transparent gateway photograph at web/public/images/gateway-cutout.png. Uses responsive Next Image sizing, intrinsic dimensions and descriptive alt text. The live-room link remains available beside the headline.
- Verified desktop and 390 px layouts, image loading and no horizontal overflow; TypeScript and page ESLint pass. No backend, protocol, engine, bridge, worker or firmware changes.

### 2026-11-07: cursor-local headline colour
- Added HeroHeadline with a soft 110 px yellow text mask that follows the pointer and fades in/out over 300 ms. All headline text rests in the default ink colour; only letters near the cursor turn yellow. Scoped styles live in globals.css to match the project's Tailwind loader.
- Pointer updates are batched through animation frames without React renders; the decorative duplicate is hidden from assistive technology. Touch uses the normal headline, reduced motion disables the transition, and forced colours hide the overlay. Browser checks confirm local masking and fade-out without overflow; TypeScript and ESLint pass.

### 2026-11-07: balance the headline accent
- Replaced scattered yellow words with one continuous yellow phrase, Press to bid, to give the landing headline a clear focal point.

### 2026-11-07: highlight the hero's key words
- Applied the existing yellow paddle colour to paddle, bid and wins in the landing-page headline, keeping its bold typography and wording.

### 2026-11-07: small logo gap adjustment
- Added 4 px of breathing room between the header symbol and Bid3 in web/src/components/brand.tsx at the owner's request.

### 2026-11-07: tighten header logo spacing
- Removed the wordmark gap and compensated for the PNG's transparent right margin in web/src/components/brand.tsx so the symbol sits directly beside Bid3.

### 2026-11-07: final logo and flat grid background
- Added the owner's supplied transparent PNG as web/public/brand/bid3-logo.png and replaced the shared header/footer paddle mark with that image in web/src/components/brand.tsx. Adjusted the footer mark size for its transparent margins.
- Added an optional glow prop to AnimatedGrid and disabled it on the landing page, removing the bright ambient patch while retaining the animated grid. Verified the logo loads and the glow is absent at desktop and 390 px widths; TypeScript and ESLint pass.

### 2026-11-07: landing-page animated grid background
- Added the supplied CSS-only AnimatedGrid component in web/src/components/ui/animated-grid.tsx and placed it behind the landing page in web/src/app/page.tsx. Uses the existing line/cobalt theme tokens; no new dependencies or changes to page content and auction behaviour.
- Kept the backdrop decorative and pointer-transparent, with scoped reduced-motion and forced-colour rules. Verified desktop and 390 px layouts without horizontal overflow; TypeScript and ESLint pass. No open items for this change.

### 2026-11-07 ~03:30 IST: auctioneer opens bidding; catalogue of real lots; sellers from any wallet
Kev asked for this (Sat ~02:15). He also asked that working code not be disturbed, so every part below was tested before being called done.

- **Engine rules (`engine/bid3_engine/auction.py`):**
  - `open()` goes straight to OPEN: the operator declares bidding open.
  - No two-paddle minimum: joining no longer opens bidding, and leaving no longer sends the lot back to LOBBY.
  - Resuming with no leader returns to OPEN.
  - The "two paddles were never on together" closing check is removed, so a **lone bidder wins** at their bid.
  - The no-bid timer (`timeLimitMs`) was already counted from opening and already closes the lot UNSOLD.
  - A lot an older engine left in LOBBY opens on its first JOIN.
  - `hadCompetition` is still tracked but no longer required. It isn't part of AuctionResult, so the Arkiv contract is unchanged.
- **`GET /auctions`** now also returns `leaderAlias`, an extra field.
- **Engine tests:** 4 updated to the new rule, 5 added (lone bidder wins; timer from opening; joining mid-countdown can bid; leaving doesn't close bidding; old LOBBY lot opens on join). `pytest` 49 passed. Firmware `test_current_engine_v4` OK, bridge 2 passed, vectors unchanged, `check-schemas` OK.
- **Web rules wording and simulator** match the engine (`simulator.ts`, `phase-copy.ts`, seat page, simulation controls).
- **Lots page:**
  - New `web/src/lib/lot-state.ts` gives each lot's real state: from the engine's `GET /auctions` (polled every 5 s), otherwise from publisher-owned AuctionResults on Arkiv, otherwise "Up next".
  - The lot card shows Live now / Up next / Sold to Paddle X for Y / Unsold, back with the seller.
  - The status chips filter on that state. Category and price filters are still Arkiv queries.
  - Listings and results refetch every 15 s, so new listings reach every viewer.
- **Six demo items** (`arkiv-worker/src/seed-catalogue.ts`, `npm run seed-catalogue`): lots 11–16, `bid3-cat-11`…`16`, `item-11`…`16`, status UPCOMING, listed for 7 days, owned by the publisher. Written to Arkiv at ~03:00; a second run skipped all six.
- **Admin page `/admin`:** password sign-in, "On the block" with Withdraw, the no-bid timer (1/2/5/10 min), and the lot list with "Open bidding" on Up-next lots.
  - Server routes `/api/admin/{login,start,cancel}` and `web/src/lib/admin/server.ts`. `ADMIN_TOKEN` and `ADMIN_PASSWORD` stay on the server.
  - It refuses to start while another lot is still running.
  - It seats the paddle roster (`web/src/lib/admin/paddles.ts`, checked identical to the firmware template) with house rules: 5%, 10 s, ceiling 10× the opening bid.
  - Tested the route handlers against a fake engine: not configured gives 503; wrong password 401; a bad timer or ID 400; another lot running 409; withdraw works; start creates the right body and then opens; a duplicate lot gives 409; every engine call carries the token.
- **Sell an item:** one form (title, category, condition, opening bid, description), published from the connected wallet.
  - It switches the wallet to Rabdi, adding the network if needed, and shows friendly errors for no tGLM (with a faucet link) and a cancelled signature.
  - Lot numbers continue after the highest listed.
  - "Your lots" shows the seller each outcome; unsold lots say "back with you". This is the seller's notification.
  - The old Rules, Paddles, Readiness and operator `curl` steps are gone: the auctioneer applies house rules from the admin page.
- **Web checks:** whole-app `tsc` and `eslint` clean; `next build` passes (in a scratch copy; Kev's `web/.next` untouched).
- **Not tested:**
  - In a browser: the admin page, the new Lots page and the seller page.
  - A real seller publish from MetaMask: the switch to Rabdi, gas, the write.
  - The new engine rules with the real paddles.
- **To go live:**
  1. Stop `auto-rounds` and restart the engine; the new rules need it. Lot `bid3-007`, left in LOBBY by the old rules, then opens on the first JOIN; withdraw it from `/admin` if not wanted.
  2. Add `ADMIN_TOKEN` and `ADMIN_PASSWORD` in Vercel.
  3. Commit and push.
- **Not updated (Sanskar's, checksummed):** `firmware/BIDDING_RULES.md` line 8 still says fewer than two bidders means LOBBY, and `FAST_PROTOCOL.md` and `VALIDATION.md` mention LOBBY. The firmware works unchanged: it just shows OPEN sooner.

### 2026-11-07 ~02:05 IST: automatic back-to-back rounds
- **New `scripts/auto-rounds.sh`:** opens the next lot (via `new-lot.sh`) and prints a line whenever the phase, bid count, leader or paddles change.
  - After a sale it waits `PAUSE_S` (default 20 s), then opens the next lot.
  - It stops by itself when a lot closes UNSOLD or CANCELLED, so an unattended room doesn't keep publishing empty lots to Arkiv.
  - If a lot is already running when it starts, it watches that lot first. `--watch <id>` only shows one lot's progress.
- **No paddle toggling between lots:** confirmed in `bridge/bid3_bridge.py` that the bridge sends `CMD=STATUS` when the `auctionId` changes, which asks the gateway to re-announce switched-on tags. The open Live room page follows to each new lot.
- **Checked under macOS bash 3.2:** `--watch` on three closed lots returns at once with the right lines, and the stop and continue rules work. **Not checked:** the full loop, because it opens real lots on the engine and Arkiv. Its first real run will be the test.
- **Merge check:** Kev's merge of PR #2 kept both sets of log entries, and there are no conflict markers left.

### 2026-11-07 ~01:45 IST: new-lot.sh picks the next number
- `scripts/new-lot.sh` with no argument asks the engine's `GET /auctions` for the highest `bid3-NNN` and opens the next one. Right now that's 6 (it has 3, 4 and 5; `bid3-hw-01` is ignored). An explicit number still works.
- **Checked:** the number it picks, rejected arguments, and refusal of an existing ID. The no-argument path wasn't run end to end, because that would open a real lot.
- **Pulling `origin/main`:** it has Sanskar's 3 firmware commits (PR #2, V6 reconnect fix: gateway sources, docs, checksums, one C++ test) plus entries in this log. A simulated merge (`git merge-tree`) conflicts only in `PROJECT_LOG.md`, where both sides added entries at the top; keep both. No engine, bridge, worker or web file is touched. The new firmware only takes effect once it's flashed to the boards.
- The 7 files to commit were scanned for the engine tokens, the publisher key, the old leaked key and the access key. None are present, and both `.env` files are gitignored.

### 2026-11-07 ~01:30 IST: live room follows the next lot
- **Problem:** `/room/bid3-004` kept showing lot 4 after `scripts/new-lot.sh 5` opened `bid3-005`, because the room is tied to the lot in its URL. On the deployment URL Kev was using (`web-a4iifikev-…vercel.app`), the engine's CORS also blocks `/health`, so even the header link fell back to `NEXT_PUBLIC_FEATURED_AUCTION_ID`.
- **Change in `web/src/app/room/[auctionId]/room-view.tsx`:**
  - If the page watched a lot live, and the engine's `activeAuctionId` (from `/health`, polled every 10 s) moves to another lot after that lot closes, the room switches to the new lot in place.
  - The address bar is updated with `history.replaceState` (supported by Next 16's router), so there's no navigation, no remount, and full screen survives.
  - Title, snapshot and bids link use the state's own `auctionId`, so a stale old-lot frame never shows under the new lot's title.
  - Opening an old lot's room directly (for example from Results) shows a "newer lot is live" link instead of moving.
- **Checked:** `tsc --noEmit` and `eslint` pass. **Not checked:** behaviour in a browser; the next `new-lot.sh` run will exercise it. Live on Vercel only after Kev commits and pushes.
- **Use `https://bid3.vercel.app`.** It's the only Vercel origin in the engine's `CORS_ORIGINS`; the follow logic needs `/health`.

### 2026-11-07 ~01:15 IST: first full hardware round verified on Arkiv
- **Round:** `bid3-004` ran on the real gateway and paddles (after replugging the CH340 gateway and restarting the bridge). There were 11 bids alternating M4 and K7, from 100.00 up to 162.89. It sold to M4 at 162.89, and the live room on Vercel showed it in real time through the tunnel.
- **Read back from Arkiv** with the SDK, filtered to the new publisher `0xCf11…e32d`:
  - Listing `lot-004`: entity `0x3069d66f…8fd6`.
  - AuctionDefinition: rules hash `0x385c7900…c5d2`, entity `0x2476a5a3…71a3`.
  - All 11 AuctionBid entities, prices matching the +5% ladder.
  - AuctionResult: SOLD, M4, 162.89, 11 bids, entity `0x6d84cd90…1222`.
- **Cost:** the whole round (listing, rules, 11 bids, snapshots, result) used 0.00444 tGLM of gas. The publisher has 9.983 tGLM left. Prices are demo credits; no ETH or tokens change hands.
- **Note:** Kev's screenshot was on the deployment URL `web-a4iifikev-kevstatics-projects.vercel.app`. The engine's CORS only allows `https://bid3.vercel.app` (and localhost), so use `bid3.vercel.app` for the demo. The WebSocket worked on the other URL, but its HTTP calls to the engine are blocked there.

### 2026-11-07 ~00:20 IST: gateway connected but presses not reaching the engine
- **What happened:** `bid3-004` opened at 00:13 and went straight to PAUSED with "The gateway is down". Its input log had no JOIN or BID.
  - The gateway's OLED counted presses, but that's only its local receipt.
  - The bridge had logged nothing except `engine connected`.
- **Cause:** the gateway's USB-serial chip is a CH340 (`1a86:7523`) on macOS's built-in driver.
  - `/dev/cu.usbserial-10` opens and `tcgetattr` works, but every `tcsetattr`, even with unchanged settings, fails with `(22, 'Invalid argument')`. The driver is stuck; unplugging and replugging the gateway clears it.
  - The bridge retried every 2 s without logging, because it only logged a failure after a previous success.
- **Fix in `bridge/bid3_bridge.py`:** a failure to open the port is now logged once per distinct error, with a hint to replug. Logging only; the serial protocol is unchanged.
  - Checked: bridge `pytest` 2 passed; a missing port is logged exactly once over 6 s; firmware `test_current_engine_v4` passes.
  - Not run locally: the firmware C++ host checks (the local clang/SDK linker is broken: "unknown architecture arm64e.x1") and two tests that need `cryptography`. Both fail the same way on the unmodified bridge.
- **Engine behaviour confirmed from the code:** the no-bid time limit doesn't run while a lot is paused, and the engine resumes on its own when the gateway reports ok.

### 2026-11-07 ~00:15 IST: background tunnel
- **Problem:** each `cloudflared` restart got a new random quick-tunnel URL, so Vercel needed a redeploy. It kept happening because the tunnel ran in a VS Code terminal and died when terminals were closed.
- **New `scripts/tunnel.sh`:** starts `cloudflared` in the background (nohup, metrics on `127.0.0.1:20299`), or reuses the one already running.
  - Prints the URL and whether the engine answers through it.
  - Checks the live site's bundle to see which tunnel URL it was built with, and says exactly what to change in Vercel if it doesn't match.
  - `scripts/tunnel.sh stop` stops it.
- **Checked:** two full start/reuse/stop cycles. It reports the engine as not running when it's down and detects the stale Vercel build. It hasn't been run against a running engine yet.
- **Runbook (section 5):** now four terminals; the tunnel isn't one of them.
- **First real run (~00:20):** the tunnel `vaccine-furnished-with-boat.trycloudflare.com` took longer than the script's 30 s check to start answering, then worked. The script now waits up to 90 s and says it's waiting. Vercel still needs this WS URL set, `NEXT_PUBLIC_ENGINE_HTTP_URL` deleted, and a redeploy.
- **Options considered for a permanent URL:**
  - Tailscale Funnel: free, no domain needed, stable `*.ts.net` name. In beta; WebSocket support isn't stated in its docs, so it needs testing.
  - ngrok's free static domain: 20,000 requests a month. The site polls `/health` every 10 s per open tab, about 8,600 a day, so it could run out during judging.
  - Named Cloudflare tunnel: needs a domain on Cloudflare.
  - Not adopted for now.

### 2026-11-06 ~23:55 IST: terminal runbook
- Section 5 now has the five-terminal live setup (engine, tunnel, worker, bridge, ops), with the command to run in each and the line that shows it's ready.
- **Checked the redeployed site:** publisher `0xcf11…e32d`, `arkivMode: "live"` and featured `bid3-004` are built in, and the WS URL is the current tunnel. **But `NEXT_PUBLIC_ENGINE_HTTP_URL` was still the dead `emphasis-press-strips-danny` tunnel.** Kev will delete it in Vercel; the app derives the HTTP URL from the WS URL.
- The worker running at that point was started at 23:21, before the key rotation, so it still used the leaked key. Kev is restarting all terminals.

### 2026-11-06 ~23:45 IST: first hardware round; publisher key leaked and replaced
- **The hardware round works end to end.**
  - Lot `bid3-hw-01`: both paddles joined through the gateway with signatures required. M4 bid 100.00, and the lot hammered SOLD after the 10 s countdown.
  - The worker published the result. `npm run query-results` shows it on Arkiv along with `bid3-003` UNSOLD.
- **Publisher key leak:** `NEXT_PUBLIC_PUBLISHER_ADDRESS` in Vercel held the publisher's private key, not its address, so it was built into the public bundle at `bid3.vercel.app`.
  - Git and the local env files were checked: the key is in neither.
  - Old publisher `0xcA499f30Eb36B6Cd76520B90457E1a3FCbc3242f` is abandoned. Its two results now count as unverified, which is correct.
  - New publisher `0xCf11CEa33b48A48901DD2a03730524a69E64e32d`. Its key was generated straight into `arkiv-worker/.env` and never displayed.
  - 9.987 tGLM moved from the old wallet to the new one, with Kev's approval: tx `0x766c91c57629bb46b6b945843ea8c739cafb6822df666dcf554dcc35eeaec8fb`, block 301264.
  - Older Vercel deployments still contain the old key; the wallet is empty and abandoned.
- **Tunnel:** `cloudflared` was restarted, so the URL is now `subsidiary-equivalent-saved-rachel.trycloudflare.com`. The old one returns 530.
- **Why Results showed only demo data:** the site was built with `NEXT_PUBLIC_ARKIV_MODE=sample`, and its "publisher address" was the private key.
- **Code:**
  - `arkiv-worker/src/seed-listings.ts` takes a lot number: `npm run seed-listings -- 4` lists `lot-004` for `bid3-004`. The default is still 3.
  - New `scripts/new-lot.sh <n>`: lists lot N on Arkiv, creates `bid3-00N` from the firmware template with `listingId lot-00N` and a 30-minute no-bid limit (override with `TIME_LIMIT_MS`), and opens it. It refuses an ID the engine already has.
  - Checked: worker `typecheck` and `check-schemas` pass; the script's argument checks and duplicate-ID guard work. The script's full run has not been tested, because it writes to Arkiv.
- **Open:**
  - In Vercel: set the new publisher **address**, the new tunnel URLs, `NEXT_PUBLIC_ARKIV_MODE=live` and `NEXT_PUBLIC_FEATURED_AUCTION_ID=bid3-004`, then redeploy.
  - Restart the worker so it loads the new key, before opening any lot.
  - `query-results` with no access key hung for more than 5 minutes on the public endpoint; with the key it took a few seconds. The README tells judges it "needs no key", so check that before submitting.
  - The README's writer-wallet TODOs should name the new publisher.

### 2026-11-06 ~22:15 IST: hosting moved to the laptop
- **Why:** the Railway trial expired. Render's free tier sleeps after 15 minutes idle, wipes its filesystem (the SQLite journal and outbox) and has no free background workers. Kev chose the laptop with a tunnel over paying.
- **Setup:**
  - Engine, worker and bridge all run on the laptop and talk over `localhost`.
  - Only the browser needs the tunnel: `cloudflared tunnel --url http://localhost:8010` gives a `https://….trycloudflare.com` URL, and Vercel's `NEXT_PUBLIC_ENGINE_WS_URL` / `NEXT_PUBLIC_ENGINE_HTTP_URL` point at it.
  - The quick-tunnel URL changes every time `cloudflared` restarts. Vercel then needs both URLs updated and a redeploy.
- **New local files (gitignored, not committed):**
  - `engine/.env`: fresh tokens, `DATABASE_PATH=./data/live.sqlite`, `SEED_DEMO=0`, `INTENT_SIGNATURES_REQUIRED=1`, `REQUIRE_TOKENS=1` (the engine is public through the tunnel, and token checks only switch on by default on Railway).
  - `arkiv-worker/.env`: `ENGINE_URL=http://localhost:8010` and the same `WORKER_TOKEN`. `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` are left for Kev to fill in.
- **Still open:**
  - The old engine (PID 2478, since 12:50, `data/v5.sqlite`) is still on :8010. Stop it before starting the new one.
  - ~~Add the Vercel production URL to `CORS_ORIGINS`.~~ Done (~23:15): the site is `https://bid3.vercel.app`, and `engine/.env` has `CORS_ORIGINS=http://localhost:3000,https://bid3.vercel.app`. It takes effect on the next engine restart.
  - At 23:15, the live Vercel build still had no `NEXT_PUBLIC_*` values built in: its bundle reads them as unset. It needs a redeploy after the env vars are saved.
  - `bid3-003` closed UNSOLD at 23:03 (opened 22:53 with no paddles). Its UNSOLD result is on Arkiv, so that ID is used up. The real round needs a new `auctionId`, and `seed-listings` still hard-codes `bid3-003` / `lot-003`.
  - The live room only works while the laptop is awake and online; the Arkiv data stays readable regardless.
  - The READMEs (root, `engine/`, `arkiv-worker/`) still describe Railway.

### 2026-11-06 ~21:30 IST: env files
- **Neither the engine nor the bridge loads a `.env` file.** They read only the shell environment; there's no dotenv. The worker (`tsx --env-file-if-exists=.env`) and the web app (`.env.local`) do load theirs.
- Fixed the misleading first line of `engine/.env.example` to say how to load it: `set -a; source .env; set +a`.

### 2026-11-07: prepare final V6 reconnect pull request
- Integrated current main into firmware to resolve the shared project-log conflict before creating the requested PR. Preserved both sets of log entries and all current main runtime/Arkiv/transcript work.
- The final V6 reconnect ZIP remains the firmware source of truth: all gateway, tag and shared source bytes are unchanged by integration. The later local verification-timing variant remains excluded.
- Rechecked the merged engine suite, firmware/bridge host checks and Arkiv schema agreement; GitHub checks validate the integration commit. This prepares the PR only; no merge into main, cloud deployment or device flash is performed.

### 2026-11-07: publish the user's final V6 reconnect archive
- The user explicitly requested uploading only Downloads/JOB/Bid3_Firmware_V6_ReconnectFix_2026-11-06.zip to origin/firmware, authorizing this commit/push over the usual Kev-only convention. Archive SHA-256: 4e1fc3857d6c9bfe2a1493ca6ffcaa0968ee7baa1f33db830a73ebd12cfce727.
- Imported the supplied V6_RECONNECT_FEEDBACK_FIX gateway, Tag01, Tag02, canonical shared headers, regression and documentation. Every board/shared source is byte-identical to the archive. The separate local verification-timing experiment is not included.
- Kept the existing canonical bridge/engine and repository validation/dependency paths; verified the archive's duplicate bridge and engine runtime source already match those canonical files. Adapted documentation links and regenerated the repository checksum manifest. No backend/web runtime or cloud/device deployment change.
- Verified archive integrity, all source checksums/shared copies, 13 sanitized C++ programs, 23 firmware + 2 bridge Python tests and all 44 engine tests before push. GitHub board CI is checked afterward. Physical RF/acoustic acceptance remains unchanged.

### 2026-11-06: prepare V6 firmware pull request against current main
- Merged main's deploy/demo hardening into firmware before creating the requested pull request. Preserved the latest port 8010 defaults, token enforcement/redaction, new-lot broadcast fix, seller/Arkiv work and all project-log entries.
- Resolved append-only conflicts in PROJECT_LOG.md and engine/tests/test_api.py by retaining both V6 fault-isolation regressions and main's new-auction notification tests. Firmware source/keys/wiring are unchanged.
- Rechecked firmware integrity/host regressions, all 44 combined engine tests and Arkiv schema drift before publishing the merge. The user's explicit pull-request request authorizes this integration commit/push; no PR merge, cloud deployment or device flash is performed.
### 2026-11-06 ~21:15 IST: go-live preparation
- **Don't start the worker against the engine running since 12:50.**
  - It runs old code: no V6 rule, no token or transcript changes.
  - Its only lot, `bid3-room-01`, is UNSOLD with `listingId: "REPLACE_WITH_LISTING_ENTITY_KEY"` (from `firmware/integration/auction-template.json`).
  - Its outbox holds 3 records, which would be published permanently under the publisher wallet.
  - Restart on merged `main` with a fresh `DATABASE_PATH`, `SEED_DEMO=0` and `INTENT_SIGNATURES_REQUIRED=1`.
- **Live lot:** create it from the firmware template (enrolled paddle public keys, 10 s countdown), overriding the IDs to match the `seed-listings` lot (`auctionId: bid3-003`, `listingId: lot-003`). Use `jq`; the template file is left unchanged.
- **New `bridge/tools/latency.py`:** reads `BID3_LATENCY_JSON` lines (the paddle's own button-to-engine-ack timing) from a paddle's USB serial or a saved log, and prints n, median, p90, min, max and counts by result code. Tested on a sample log.
- **`arkiv-worker/src/index.ts`:** bid write log lines now add "N ms after the engine accepted it". This gives `why-arkiv.md` its number. Worker typecheck passes.

### 2026-11-06 ~21:00 IST: README after the firmware merge
- `firmware` is merged into `main` (PR #1, then `dce4254`). The merge kept `main`'s root README, which dropped the firmware branch's README sections.
- **Restored in `README.md`:**
  - a "Hardware and firmware" section: boards, V6, links to `firmware/START_HERE.md`, `README.md`, `INTEGRATION_BRIEF.md`, `BIDDING_RULES.md` and `VALIDATION.md`
  - the pinned toolchain and the reminder to deploy the engine from this repo
  - the verification commands and the CI link
  - the Architecture table now points at `firmware/` instead of the branch
- **"How a round works"** now states the V6 rule: one lost paddle is blocked while the others and the countdown continue; gateway, bridge or engine loss pauses the room. Section 1 of this log already said this. No file under `firmware/` was changed.
- **Merged `main` checked:**
  - engine `pytest` 45 passed
  - bridge tests 2 passed (they need `pyserial`, so run them with `bridge/requirements.txt` installed)
  - `check-schemas` passes; vectors regenerate unchanged; web `tsc` clean
  - all 40 relative links in the README and `arkiv/*.md` resolve

### 2026-11-06 ~20:00 IST: firmware confirmed as built at Mumbai
- **Kev confirmed:** none of the paddle/gateway firmware existed before the event. Earlier wording here called it "pre-existing"; that was wrong. Section 6, item 7 is corrected.
- **README** "What we built at Mumbai, and what we reused" now says all code was written at Mumbai and lists only public reuse. Taken from the `firmware` branch:
  - Arduino and the Espressif ESP32 core: BLE, mbedTLS, FreeRTOS, Wire, Preferences.
  - The Adafruit GFX classic 5×7 font, BSD licence.
  - Seeed XIAO ESP32-C3 paddles and an ESP32-WROOM gateway.
- **Still to confirm with the firmware author:** some firmware wording reads like older work.
  - `Tag01/BagTrailTag.h`: "original identity/NVS and legacy proof v1 retained".
  - `LEGACY_TAG_PROTOCOL.md`: "BagTrail … protocol v1".
  - `firmware/README.md`: "reuses the original owner-tested BLE advertisement format".
  - If this is BagTrail code written here before the pivot, add the one-line explanation drafted in the README's TODO box. Otherwise the README must disclose it.

### 2026-11-06 ~19:45 IST: track and rules
- **Track:** Build on Arkiv (from scratch). README, `why-arkiv.md` and `reach.md` no longer carry the existing-projects wording.
- **Sources:** ETHGlobal's rules, read from `ethglobal.com/events/mumbai/info/details`, `/info/start` and `/rules`.
- **Deadline:** Sat 7 Nov 09:00 IST, no late submissions.
- **Prior work:** "Any prior project-specific code, designs, or assets are not allowed unless they're from public libraries or starter kits." Projects built before the event "won't qualify for partner prizes". Undisclosed prior work can mean disqualification and a ban.
  - **Firmware is the risk.** Section 6 of this log called the tag/gateway firmware "pre-existing work". If any firmware predates the event, disclose it in the README and in writing to ETHGlobal, and ask whether the Arkiv prize still applies.
  - The README's "What we built at Mumbai, and what we reused" section now says this, with TODOs for the facts.
- **Commit history:** "single commits of large files without proper history" are "default assumed to be unqualified unless proven otherwise". Our first commits are large: web 11,955 lines (09:02), backend 4,635 (09:53), firmware 4,953 (10:42).
  - Evidence that they were built at the event: the timestamped entries in this log, and the AI chat transcripts.
  - From now on, commit in small steps. Don't rewrite history.
- **AI:** allowed to assist, "not to create the entire project". Document where and how it was used. Spec-driven work must "include all spec files, prompts, and planning artifacts".
  - The planning docs named in section 3 (`EthGlobal/Plans/…`) are missing: the folder is empty on this machine. Add them to the repo.
- **Demo video:** no AI voiceover or text-to-speech.

### 2026-11-06 ~19:00 IST: Arkiv write-ups, root README and a judge-runnable query (drafts)
- **Requirements**, from https://ethglobal.com/events/mumbai/prizes/arkiv. Build tracks, 25% each:
  - `arkiv/friction.md` (feedback)
  - `reach.md` (who it's for, can they try it, after Mumbai)
  - `why-arkiv.md` (what users lose with Postgres; what's kept off Arkiv)
  - `how-you-use-arkiv.md` (filters, owners and expiry fit the app; each feature changes something users see)
  - The README must list the writer wallet address(es) and "one query we can run", have an open-source license (MIT ✓), and say how AI was used.
  - **Not counted:** "the SDK installed but never used to read, or Arkiv used only as a log that nothing reads."
- **Track (decision for Kev):**
  - "From scratch" requires the project to be built at Mumbai; the page doesn't say whether pre-existing hardware or firmware is allowed.
  - "Existing projects" requires the Continuity batch, and the README must separate prior work.
  - The drafts use the from-scratch questions and note the existing-project wording.
- **New files:**
  - `arkiv/friction.md`: 5 real issues with expected, actual, repro and workaround, plus what worked. Ownership not implied by schema tags; `$createdAt` not sortable; no idempotent create (`predictEntityKeys` depends on the nonce); `readonly` entities are still deletable by the owner; explorer link format undocumented.
  - `arkiv/why-arkiv.md`, `arkiv/how-you-use-arkiv.md`, `arkiv/reach.md`.
  - `README.md` rewritten.
  - `arkiv-worker/src/query-results.ts` plus `npm run query-results -- <publisher>`: the judges' query (results `ownedBy` publisher, newest first, no key needed).
- **Corrected while checking:** the worker comment that keys "can't be fixed in advance". They can be predicted, but only for the current nonce.
- **Checked:**
  - Worker `npm ci`, `typecheck` and `check-schemas` pass.
  - `query-results` runs against the live Rabdi testnet (0 results so far, as expected) and rejects a bad address.
  - All 32 relative links in the README and `arkiv/*.md` resolve.
  - SDK facts quoted in the docs come from the installed SDK's type docs.
- **Open: 23 TODO (Kev) markers.** Wallet addresses, live URL, video, track, evidence and numbers in `reach.md`, plans after Mumbai, the before/at-Mumbai split, measured latency, the AI statement, the explorer URL, the extend button (build or cut), and friction entries from going live. `arkiv/schema.md` still has its own "fill in wallet addresses" line.

### 2026-11-06 ~18:00 IST: results page re-checks every bid and the transcript
- **Two new browser checks** in `web/src/lib/use-verification.ts`, shown in `explorer-view.tsx` with sidebar explanations:
  - **Every bid on the ladder:** reprices each `AuctionBid` with `priceAtBid` from the published rules. It fails on a wrong price, a gap in `bidIndex`, or a paddle outbidding itself.
  - **Transcript matches:** recomputes `transcriptDigest` from the bid entities and compares it to the one in `AuctionResult`.
- **Bug fix:** a CANCELLED result with bids used to fail "history" as if bids were forbidden. It now compares the bids with the result's `bidCount`. Bids are also filtered to the result's `epoch`.
- **New contract** (section 4): `web/src/lib/transcript-digest.ts` ↔ `engine/bid3_engine/auction.py`.
  - The engine's digest is now a module-level `transcript_digest(bids)`. The method calls it, so behaviour is unchanged.
  - `make_vectors.mjs` now also emits 3 transcript vectors (empty; out-of-order bids; non-ASCII, emoji, DEL, quotes and newline). `test_vectors.py` checks them. Existing pricing and hash vectors are byte-identical.
- **Sample data** now carries real transcript digests (it used fake ones), so the sample explorer's checks are honest.
- **Checked:**
  - Engine `pytest`: 40 passed.
  - Web `tsc` and `eslint` clean; `next build` passes (built in a scratch clone so Kev's `next dev` wasn't touched).
  - In the browser (sample mode): 3 results pass all 5 checks; the impostor result fails only "issuer", as intended.
- **Not checked:** a failing ladder or transcript case in the browser (only the passing paths were seen); live Arkiv data (worker not live yet).

### 2026-11-06 17:00 IST: deadline moved up
- Section 2 "Event timing" now says **Sat 7 Nov 09:00 IST** (Kev), with a 01:00 hardware cut-off. Every chat should plan against Saturday.
- `seed-listings` lots expire 26 h after the run. Run it after midnight so they're still up during judging.

### 2026-11-06 (evening): seller flow can't hijack the live lot's title
- **Own IDs per listing** (`web/src/app/seller/seller-flow.tsx`): a published listing gets a fresh random `auctionId` (`bid3-<time><rand>`) and a matching `listingId` (`lot-…`). It no longer reuses the live lot's ID.
- **Trusted listing lookup** (`web/src/lib/arkiv/pick-listing.ts`, used by `live-reader.ts` `getListingByAuction`): fetches every listing with that `auctionId`, then chooses by these rules, in order:
  1. Keep only the `listingId` named in the publisher-owned `AuctionDefinition`, when one exists. If none match, return no listing rather than a wrong one.
  2. Drop listings whose owner isn't their own `sellerAddress`.
  3. The publisher's own listing wins.
  4. Otherwise the earliest-created listing (`$createdAt` block) wins.
  - The sample reader is unchanged.
  - For `bid3-003`, rule 3 only protects the title once `npm run seed-listings` has run with the publisher key. Until then, the earliest listing with `lot-003` wins.
- **"Open the round" no longer a dead button:** in live mode, once the readiness checks pass, it shows the two operator `curl` commands (create + open) built from the seller's rules, paddles and new IDs, with a `$ADMIN_TOKEN` placeholder, plus a copy button and a link to the lot's room. The admin token still never reaches the browser.
- **Real bridge check:** the readiness item is now "Bridge connected to the engine", read from `GET /health` `bridgeConnected`. Previously it only checked that an engine URL was set.
- **`use-featured-auction.ts`:** now one shared React Query entry (`useEngineHealth`, 10 s poll) instead of a fetch per component.
- **Checked:**
  - `tsc` and `eslint` clean.
  - `pickListing` passed 6 rule checks (scratch script, not committed: the web app has no test runner).
  - In Kev's running `next dev` (:3000, engine on :8010), the header's Live room link follows the engine's active lot (`bid3-room-01`), and the readiness step shows the bridge as down. No console errors.
- **Not checked:**
  - `next build`: skipped because `next dev` was running on the same `.next` folder.
  - The post-publish handoff block in a browser (needs a connected wallet).
  - Live Arkiv reads.
- **Still open:** `web/README.md` is stale about the seller flow, `/open` and `POST /items`.

### 2026-11-06 (later still): engine hardening: new-lot notice, token check, token redaction
- **New lot reaches the gateway at once** (`engine/bid3_engine/runtime.py`): `open()` now sets `active_auction_id` inside `apply()`, before the broadcast, so the connected bridge gets the new lot's state immediately. This is the engine part of `stash@{0}`, copied verbatim along with its two tests in `engine/tests/test_api.py`, so applying that stash later merges cleanly.
  - The bridge on `main` doesn't send `CMD=STATUS` when the `auctionId` changes. After opening a new lot, paddles must switch off and on (or type `join TAG1` in `--keyboard` mode). The `firmware`-branch bridge in the stash does this automatically.
- **Refuse to start without tokens** (`config.py`, `api.py`): new `REQUIRE_TOKENS` setting. It's on by default when Railway env vars are present (`RAILWAY_ENVIRONMENT_ID`, `RAILWAY_PROJECT_ID` or `RAILWAY_ENVIRONMENT`), and off locally. If on and any of `BRIDGE_TOKEN`, `ADMIN_TOKEN` or `WORKER_TOKEN` is empty, startup fails with a message naming them.
- **Bridge token redacted from logs** (`__main__.py`): a `RedactTokens` filter on `uvicorn.error` and `uvicorn.access` rewrites `token=…` to `token=***`.
- **Docs:** `engine/README.md` deploy steps now cover the volume, `REQUIRE_TOKENS`, `SEED_DEMO=0` plus opening a fresh lot, and re-joining paddles after a new lot. `.env.example` documents `REQUIRE_TOKENS`.
- **Tests:** new `engine/tests/test_startup.py` (token refusal, Railway default, redaction). `pytest`: 39 passed.
- **Verified for real:** ran the engine on port 8020 (8000 is Docker's; 8010 was already taken by another Python process, left untouched). Connected a bridge with a token: the log reads `WebSocket /bridge?token=***`, and the secret appears 0 times. With `RAILWAY_ENVIRONMENT_ID` set and no tokens, it exits with "refusing to start".
- **Still open:** set the tokens and `SEED_DEMO=0` on Railway; the seller flow (unwired "Open the round", listing reuses the featured `auctionId`); the docs items from the entry below.

### 2026-11-06 (later): deploy and demo fixes from the main-branch audit
- **Default port is now 8010** everywhere (engine `__main__.py`, `.env.example`, Dockerfile `EXPOSE`, bridge default, worker default, READMEs, local `web/.env.local`). Port 8000 is used by something else on Kev's Mac; nothing was run on it.
- **`engine/Dockerfile`:** removed `VOLUME ["/data"]` (Railway rejects it). Attach a Railway volume at `/data` instead.
- **`web/src/lib/arkiv/live-reader.ts`:** definition, bid, snapshot and result reads now use `.ownedBy(publisher)`, so look-alike entities from other wallets are ignored. Listings stay open to any seller wallet.
- **Featured lot read at runtime:** new `web/src/lib/use-featured-auction.ts` fetches the engine's `GET /health` `activeAuctionId` (falls back to `NEXT_PUBLIC_FEATURED_AUCTION_ID`). Used by the home page (`featured-live.tsx`), header, seat page and seller link. `engineHttpUrl` now derives from the WS URL when unset.
- **Checked:** `tsc --noEmit` and `eslint` pass in `web/`. Not re-run: engine tests, worker typecheck (no `node_modules` there), live Arkiv reads.
- **Still open (not done here):** set `SEED_DEMO=0` on Railway and open a fresh lot before the demo (the seeded lot closes UNSOLD after 10 min); set all three tokens on Railway; ~~the engine logs the bridge URL including `token=`; gateway isn't told when a new lot opens~~ (both fixed in the entry above); seller "Open the round" still unwired and the seller flow still writes `auctionId` of the featured lot, so a test listing can replace its title; docs (`arkiv/*.md`, root README, Track row); `web/README.md` is stale about `/open` and `POST /items`; explorer URL format unconfirmed.

### 2026-11-06: V6 OFF/LOST availability and isolated tag faults
- Fixed the gateway's unconditional live-link freshness refresh: an authenticated heartbeat switch flag now controls OFF availability, radar presence and input gating. OFF is distinct from LOST; an established-session disconnect/timeout no longer stays available for the legacy 25-second proof window.
- Kept the V5 button path, audio, static LEDs, wiring, keys/NVS, advertisement format, pricing and accepted-bid binding. Debounced switch transitions send immediate state; OFF/ON generations discard unsent pre-OFF intents without sequence gaps. In-flight decisions remain authoritative at the engine.
- User confirmed: OFF/LOST blocks future bids; accepted bids remain binding; tag-specific faults isolate only that bidder; tag recovery requires a fresh JOIN and does not reset the live countdown. Infrastructure-wide pause/recovery is unchanged.
- Updated engine/bid3_engine/auction.py and its tests for isolated UNKNOWN seats and admission on recovery. Wire fields/signatures, bridge runtime, web frontend and Arkiv schemas are unchanged. Added OFF/LOST renderer, timestamp-order and heartbeat regressions and a deployable engine patch alongside the three-sketch package.
- Validation: three target builds passed, 12 sanitized C++ programs and 25 firmware/bridge Python tests passed, 36 engine tests passed and Arkiv schemas match. Physical RF/switch-to-pixel behavior is not bench-tested here. The user explicitly authorized committing and pushing V6 to the existing firmware branch, overriding the normal Kev-only convention for this update. No cloud deployment or device flash is performed.

### 2026-11-06: V5 immediate OLED input feedback
- User reports both tags now connect, but presses are discovered/displayed late. Added a session-HMAC input receipt from the button sampler and a dedicated gateway input task; the OLED can show BUTTON PRESSED / INPUT RECEIVED with count and DOWN/UP before ECDSA or engine ACKs.
- Fixed standalone JOIN/LEAVE transport timeouts causing repeated reconnects: local RECEIVED is never auction admission. Engine reconnect requests signed re-announcement. Individually signed BID verification, engine authority, stale-quote policy, 10-second rules and bound OFF leader behavior remain.
- Moved gateway ECDSA off the display core, added urgent OLED animation replacement and an 80 ms minimum press overlay, deferred missing-sensor retries while connected, and requested faster advertising/connection intervals. Preserved advertisement format, IDs/keys/NVS, startup melody, static tag LEDs and radar ring.
- Added real-header input replay/session/press-release/OLED regression checks and urgent page-reset tests; updated documentation and source package. No engine, bridge or web runtime changes. Prepared as a standalone three-sketch archive and repository sources. The user explicitly authorized committing and pushing V5 to the existing firmware branch, overriding the normal Kev-only convention for this update.
- Validation: all three sketches compiled; 11 sanitized C++ programs, 25 firmware/bridge Python checks, 31 engine tests and Arkiv schema checks passed. Physical RF/button-to-pixel timing remains unmeasured; no literal zero-latency guarantee. V4 bridge status compatibility is retained with an additional V5 firmware field.

### 2026-11-06: update firmware branch to V4 working BLE base
- The user's explicit request authorizes committing and pushing this update to the existing firmware branch, overriding the normal Kev-only convention for this update.
- Replaced V2 hardware sources with V4 from the exact owner-tested button archive. Original advertisements, discovery, NVS identities, enrolled proofs, startup melody and wiring remain; fast authenticated notifications activate only after original proof verification. Tag LEDs stay static; the radar outer ring is complete.
- Updated the single canonical bridge implementation for 115200 AUCTION messages, session-correlated ACKs, running-gateway status, WebSocket liveness, active-lot re-announcement and immediate serial line delivery. No engine/web/Arkiv runtime code is changed.
- Added bidding rules, a 10-second enrolled auction template, fast protocol documentation, baseline helper hashes, updated shared-copy/checksum checks and CI covering bridge/engine compatibility. Archives, generated binaries and local logs are excluded from Git.
- Validation: all three delivered V4 sketches compiled with core 3.3.12; repo host checks, engine tests, schema drift and firmware CI/build tooling are checked before push. Physical RF/latency/LED/acoustic acceptance remains open; no zero-latency claim. Engine v1 cross-round binding remains outside this release.

### 2026-11-06: import V2 hardware firmware and repeatable validation
- Added `firmware/` from the matching owner-supplied V2 folder/ZIP: Tag01, Tag02, Gateway, canonical shared headers, wiring/protocol docs, previews, font attribution and host regressions.
- Cleaned up tag packet initialization and guarded Bluedroid-only notification descriptors; public enrollment pins, NVS identities and wiring are preserved.
- Added checksum/shared-copy validation, pinned host test dependencies, pinned Arduino CLI/core build checks and a hardware-only GitHub Actions workflow. Generated binaries, archives, environments and caches are ignored.
- Scope: hardware source/tooling/docs only, plus this hardware status entry. No web, bridge, engine, Arkiv or worker implementation changes.
- Validation and remaining physical acceptance are recorded in `firmware/VALIDATION.md`. V2 bridge/engine interoperability remains open; the original backend serial contract is unchanged.

### 2026-11-06 ~10:05 IST: firmware branch and multi-chat setup
- **New branch:** `firmware` (on origin), for Arduino C++ tag and gateway firmware. No firmware changes pushed yet; the team is reworking the code.
  - It points at `1870e89`, so it lacks the backend commit `fac59ab`, including this log and `bridge/README.md`. Merge `main` into it.
- **Firmware contract:** the serial protocol in `bridge/README.md`.
  - Emit `AUCTION_EVENT_JSON=` for JOIN, LEAVE and BID; answer `CMD=STATUS`.
  - Optionally read `AUCTION_STATE_JSON=` and `AUCTION_ACK_JSON=` to drive the display and LEDs.
  - Default tag refs are `TAG1` and `TAG2` (the engine's `SEED_TAGS`).
- **Separate chats:** each component will be handled by its own chat in the Claude Project; this log is the shared source of truth between them.

### 2026-11-06 ~09:50 IST: project log and agent pointer
- Added `PROJECT_LOG.md` (this file) and `AGENTS.md` at the repo root so every assistant starts from the same context.

### 2026-11-06 ~09:20–09:45 IST: backend (engine, bridge, Arkiv worker)
- **`engine/` (FastAPI, Python):**
  - Pure state machine (`auction.py`) implementing the rules in section 1.
  - SQLite journal, crash-recovery snapshots and outbox (`store.py`).
  - Runtime with one serialized loop, a 50 ms tick, coalesced snapshots and broadcast (`runtime.py`).
  - API: public stream, bridge socket, operator and outbox endpoints (`api.py`).
  - Optional secp256k1 intent signatures (`intents.py`, off by default).
  - Seeds demo auction `bid3-003`.
  - 31 tests, including pricing and rules-hash vectors generated from the web TypeScript.
  - Results carry a `transcriptDigest`: sha256 over the bids, oldest first.
- **`bridge/`:**
  - `bid3_bridge.py`: serial ↔ engine with reconnect.
  - While the engine is offline it refuses presses as `CLOSED` instead of queueing them.
  - Sends `CMD=STATUS` on reconnect; has a `--keyboard` mode.
  - `tools/fake_gateway.py`: virtual serial port that plays a scripted round.
- **`arkiv-worker/` (TypeScript):**
  - Writes `AuctionDefinition` (read-only, 30 d), `AuctionBid` (read-only, 7 d), `AuctionSnapshot` (10 min) and `AuctionResult` (read-only, anyone may extend, 90 d).
  - Checks for an existing entity before retrying a write.
  - Runs dry without a key.
  - `seed-listings` script for the demo lot.
- **`arkiv/schema.md`:** entity, field, owner and expiry table for the Arkiv prize.
- **Verified:** fake gateway → serial → bridge → engine → web room in live mode → worker dry-run. Sold to M4 at 115.76, with no page errors.
- **Not verified:** live Arkiv writes (no testnet access from the build sandbox; needs the funded publisher wallet).

### 2026-11-06 ~03:30–08:50 IST: frontend (`web/`, committed as `1870e89`)
- Next.js 16 (App Router, Cache Components), React 19, Tailwind 4, TypeScript.
- **Pages:**
  - home
  - live room (big-screen price, hammer bar, paddles, bids, health, simulation controls)
  - lots catalogue (filters run as Arkiv queries)
  - bid history
  - results explorer (issuer, rules-hash and bid-history checks in the browser)
  - seller flow (listing written from the seller's wallet)
  - seat page for NFC
- `lib/`: engine contract types, exact pricing, rules hash, simulator, stream hook with reconnect, Arkiv live and sample readers, listing writer, wagmi wallet on Rabdi.

### 2026-11-06 ~01:30–03:15 IST: planning
- Direction settled on the hardware auction (BagTrail and the multi-sponsor variants dropped).
- Arkiv only; name Bid3.
- BID button added to both tags; button = bid at the next step.
- Plans written in `EthGlobal/Plans/`.
- Frontend set to Next.js; hosting set to Vercel + Railway, with the bridge on the laptop dialling out.
