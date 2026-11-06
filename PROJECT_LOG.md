# Bid3 project log

Shared memory for every person and AI assistant working on this repo. **Read this before changing anything, and add an entry to the changelog at the bottom after every change.** Newest entries go at the top of the changelog. Keep entries factual: what changed, where, why, and what's still open.

---

## 1. What Bid3 is

A live auction run with physical paddle tags, built for **ETHGlobal Mumbai (Nov 2026)**, with **Arkiv** as the only sponsor integration.

- Each bidder holds an ESP32 tag with a **slide switch** and a **BID button**.
- **Switch ON** joins the room and **switch OFF** leaves (the bidder stays eligible to come back).
- **Press BID** to bid the next price. Each accepted bid adds **5%** (exact integer maths) and restarts a short **hammer countdown** ("going once, going twice, sold").
- When the countdown ends, the **leader wins**. The leader switching off doesn't withdraw their bid.
- If a paddle, the bridge or the gateway drops out, the round **pauses**. Nothing is ever awarded while the room is uncertain.
- Every listing, bid and result is a public **Arkiv entity**, readable without our server. Payment is simulated (demo credits).

## 2. Key decisions (don't reverse without telling the team)

| Decision | Choice | Where it lives |
|---|---|---|
| Name | **Bid3** (was HoldBid) | everywhere |
| Sponsor | **Arkiv only** (one Arkiv track prize + optional Swarm bonus) | `arkiv/` |
| Track | Confirmed by the team on Fri 6 Nov. _Record which one here:_ ____ | |
| Button | **Press = bid at the next step** (not a jump bid on a running clock) | engine `auction.py` |
| Leader switches OFF | **Bid stays binding**; they can still win | engine `auction.py` |
| Step | **+5% per bid** (500 bps), configurable per auction | rules |
| Countdown | 5 s default (demo seed uses `SEED_COUNTDOWN_MS`); 8–10 s if hardware latency needs it | engine env |
| Stale presses | A press whose `stateVersion` predates the latest bid is refused as `STALE` | engine + firmware |
| Frontend | Next.js 16 on Vercel | `web/` |
| Backend | FastAPI engine + Python bridge on the laptop + TypeScript Arkiv worker | `engine/`, `bridge/`, `arkiv-worker/` |
| Hosting | Vercel (web), Railway (engine + worker, one engine instance, volume at `/data`) | READMEs |
| Firmware | Arduino C++ for the tags and gateway, on branch **`firmware`** (not on `main`) | `origin/firmware` |
| Commits | **Only Kev commits.** AI assistants write files but never run `git commit` or `git push` | — |

Event timing: submissions reported as **Sun 8 Nov 2026, 09:00 IST** (confirm on the ETHGlobal dashboard). The plan targets submitting by 07:00.

## 3. Repo layout

```
web/            Next.js frontend (room, lots, bid history, results explorer, seller flow, seat page)
engine/         FastAPI auction engine: single authority for order, price, countdown, winner
bridge/         Laptop program: gateway USB serial <-> engine WebSocket (+ fake gateway for tests)
arkiv-worker/   Drains the engine outbox into Arkiv entities with the publisher wallet
arkiv/          Arkiv prize write-ups (schema.md done; friction, reach, why-arkiv, how-you-use-arkiv to do)
PROJECT_LOG.md  This file
AGENTS.md       Pointer for AI tools: read this log first
```

**Branches**
- `main`: web, engine, bridge, arkiv-worker, arkiv docs, this log.
- `firmware`: Arduino C++ for the tags and gateway, being reworked. It was branched from `1870e89`, before the backend landed, so it doesn't yet have this log or `bridge/README.md`. Merge `main` into `firmware` so firmware work can see the serial protocol spec and the log.

**Who works where:** each component may be handled by a separate AI chat in the Claude Project "EthGlobal Hackathon" (engine, bridge, arkiv-worker, web, firmware). Every chat reads this log first, works only in its own folder or branch, changes a contract in section 4 only together with the other side, and adds a changelog entry here.

Planning documents (outside the repo): `/Users/kev/Hackathons/EthGlobal/Plans/`. These are `Bid3_Architecture_v2_2026-11-06.md`, `Bid3_Quick_Brief_v2_2026-11-06.md` and `understanding.md`. They predate the BID-button decision; where they disagree with this log, this log wins.

## 4. Contracts between the pieces (change both sides together)

| Contract | Defined in | Must match |
|---|---|---|
| Live stream messages (`snapshot`, `state`, `bid`) and `AuctionState` | `web/src/lib/types.ts` | `engine/bid3_engine/auction.py` (`state()`) |
| Exact pricing `price(n) = min(ceiling, round_half_up(start × (10000+bps)^n / 10000^n))` | `web/src/lib/pricing.ts` | `engine/bid3_engine/pricing.py` |
| Rules hash (sha256 of canonical JSON, fixed key order) | `web/src/lib/rules-hash.ts` | `engine/bid3_engine/rules_hash.py` |
| Arkiv entity schemas (5 types) | `web/src/lib/arkiv/schemas.ts` | `arkiv-worker/src/schemas.ts` (identical copy) |
| Serial protocol (`AUCTION_EVENT_JSON=`, `AUCTION_STATE_JSON=`, `AUCTION_ACK_JSON=`, `CMD=STATUS`) | `bridge/README.md` | gateway firmware |
| Outbox (`GET /outbox`, `POST /outbox/{id}/published`) | `engine/bid3_engine/api.py` | `arkiv-worker/src/index.ts` |

Checks that catch drift:

- `cd engine && python -m pytest`: the vectors are generated from the TypeScript. Regenerate them with `node --experimental-strip-types engine/scripts/make_vectors.mjs`, run from the repo root.
- `cd arkiv-worker && npm run check-schemas`

## 5. How to run everything locally

```bash
# engine (seeds and opens auction bid3-003 with paddles TAG1->K7, TAG2->M4)
cd engine && pip install -r requirements-dev.txt && python -m bid3_engine     # :8000

# bridge: real gateway, keyboard, or fake gateway
cd bridge && pip install -r requirements.txt
python bid3_bridge.py --port /dev/cu.usbserial-XXXX     # or --keyboard

# web in live mode
cd web && echo "NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:8000" > .env.local && npm install && npm run dev   # :3000

# arkiv worker (dry until ARKIV_PRIVATE_KEY is set)
cd arkiv-worker && npm install && ENGINE_URL=http://localhost:8000 npm start
```

With no env, the web app runs a labelled in-browser simulation and bundled sample Arkiv data. Every surface shows its data source (Live, Simulation, From Arkiv, Sample data).

## 6. Status and open items

**Done**

- Hardware: both tags connect to the gateway; button presses reach the gateway (test counter). _As of Fri 09:18._
- Frontend: built and committed (`1870e89`).
- Backend: engine, bridge and worker built; full round tested end to end with the fake gateway.

**Open, roughly in priority order**

1. **Gateway firmware** (branch `firmware`): emit `AUCTION_EVENT_JSON=` for switch ON/OFF (JOIN/LEAVE) and button (BID); answer `CMD=STATUS`. Optionally drive the OLED, LEDs and buzzer from `AUCTION_STATE_JSON=`. Spec in `bridge/README.md`.
2. **Real-hardware round:** run engine + bridge + web against the real gateway; measure press-to-ack latency and confirm the countdown length.
3. **Arkiv:**
   - Create and fund the publisher wallet; get an access key.
   - Run the worker live and run `npm run seed-listings`.
   - Set `NEXT_PUBLIC_ARKIV_MODE=live`, `NEXT_PUBLIC_ARKIV_ACCESS_KEY` and `NEXT_PUBLIC_PUBLISHER_ADDRESS` in web.
   - Confirm the explorer entity URL format in `web/src/lib/config.ts` (`explorerEntityUrl`).
4. **Deploy:** Vercel (`web`, root dir `web`) and Railway (`engine` with volume, `arkiv-worker`); set the env vars from each `.env.example`.
5. **Arkiv write-ups:**
   - `arkiv/friction.md`: log snags as they happen, with time, expected, actual and repro.
   - `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.
   - Writer wallet addresses and a runnable query in the README.
6. **Web placeholders:** the seller's "Open the round" and listing IDs need wiring to the engine's `POST /auctions` and `/open`; the seller sign-in is not built yet.
7. **Submission:** root README must separate pre-existing work (hardware, tag/gateway firmware) from Mumbai work, include measured latency, and say how AI was used. Demo video, 3 minutes or less.

## 7. Rules for assistants

- Read this file first. Append a changelog entry after your change, newest first.
- Never commit or push; Kev does that.
- Never put private keys in `NEXT_PUBLIC_*` vars or in the repo. The publisher key lives only in the worker's environment.
- If you change a contract in section 4, change both sides in the same session and run the drift checks.
- Keep the engine as the only authority: browsers never decide a winner, and nothing on Arkiv sits in the live bid loop.
- Label anything simulated as simulated.

---

## Changelog

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
