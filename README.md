# Bid3

**A live auction you bid in by pressing a physical paddle, with every listing, bid and hammer price on Arkiv, so anyone can check the result without trusting us.**

Built at ETHGlobal Mumbai (November 2026).

| | |
|---|---|
| Live app | **TODO (Kev):** Vercel URL |
| Demo video (≤ 3 min) | **TODO (Kev):** link |
| Arkiv track | Build on Arkiv (from scratch) |

## How a round works

1. Each bidder holds an ESP32 paddle with a **slide switch** and a **BID button**. Switch on to join the room; switch off to leave.
2. Once two paddles are on, bidding opens. **Each press bids the next price**: +5% per bid, computed with exact integer maths from the start price.
3. Every accepted bid restarts a short hammer countdown ("going once, going twice, sold"). When it ends, the leading paddle wins. Accepted bids stay binding, even if that paddle switches off or loses signal.
4. If **one paddle** loses signal, only that bidder is blocked (its display shows LOST). Everyone else, and the countdown, carry on. To come back, the paddle re-authenticates and joins again, without restarting the countdown. If the **gateway, bridge or engine** drops out, the whole room **pauses** and nothing is sold until it recovers.
5. The rules, every accepted bid and the result are written to Arkiv. The [results page](web/src/app/explorer/explorer-view.tsx) re-checks each result in your browser, reading only from Arkiv: issuer wallet, rules hash, bid count, every bid's price, and a hash of the full bid transcript.

Payment is simulated (demo credits).

## Arkiv

**Wallets that wrote our entities** (Rabdi testnet, chain ID 7794095):

| Role | Address | Writes |
|---|---|---|
| Bid3 publisher | **TODO (Kev):** `0x…` (printed by the worker on start) | `AuctionDefinition`, `AuctionBid`, `AuctionSnapshot`, `AuctionResult` |
| Demo seller | **TODO (Kev):** `0x…` | `ItemListing` (each seller writes from their own wallet) |

**A query you can run.** It reads our results straight from Arkiv, needs no key and doesn't touch our servers:

```bash
cd arkiv-worker && npm install
npm run query-results -- <publisher address>
```

That runs ([`arkiv-worker/src/query-results.ts`](arkiv-worker/src/query-results.ts)):

```ts
client.select().from(AuctionResult).ownedBy(publisher).orderBy(desc("closedAtMs")).limit(20).fetch()
```

The Lots, Bid history and Results pages each show the exact query behind them, with a copy button.

**Write-ups for judges:**
- [`arkiv/schema.md`](arkiv/schema.md): entities, the fields we query, owners and expiry
- [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md): why each filter, owner and expiry fits the app, and what users see
- [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md): what users would lose with Postgres, and what we kept off Arkiv
- [`arkiv/reach.md`](arkiv/reach.md): who it's for and how to try it
- [`arkiv/friction.md`](arkiv/friction.md): our feedback

## Architecture

```
ESP32 tags ──radio──▶ Gateway ──USB serial──▶ bridge (laptop) ──WebSocket──▶ engine (FastAPI)
                                                                               │        │
                          browsers ◀── live stream (WebSocket) ────────────────┘        │ outbox
                              ▲                                                         ▼
                              └──────── reads (no Bid3 server involved) ◀── Arkiv ◀── worker
```

| Folder | What it is |
|---|---|
| [`engine/`](engine/) | The only authority on order, price, countdown and winner. Python/FastAPI with a SQLite journal. Queues Arkiv records in an outbox, so the room never waits on the chain. |
| [`bridge/`](bridge/) | Runs on the laptop the gateway is plugged into: USB serial ↔ engine WebSocket. Has a `--keyboard` mode and a fake gateway for testing without hardware. |
| [`arkiv-worker/`](arkiv-worker/) | Drains the engine's outbox into Arkiv entities with the publisher wallet. |
| [`web/`](web/) | Next.js app: live room, lots, bid history, results explorer, seller flow, NFC seat page. Reads Arkiv directly in the browser. |
| [`arkiv/`](arkiv/) | The Arkiv write-ups above. |
| [`firmware/`](firmware/) | Arduino C++ (V6) for the two paddles (`Tag01/`, `Tag02/`) and the gateway (`Gateway/`), with host checks in `tools/`. See [Hardware and firmware](#hardware-and-firmware). |

Exact pricing, the rules hash and the transcript digest are implemented in TypeScript and in Python. The engine tests check the Python against vectors generated from the TypeScript (`cd engine && python -m pytest`).

## Run it locally

Defaults use port **8010** for the engine.

```bash
# engine: seeds and opens demo auction bid3-003 (paddles TAG1→K7, TAG2→M4)
cd engine && pip install -r requirements-dev.txt && python -m bid3_engine

# bridge: real gateway, or --keyboard to type "join TAG1", "bid TAG2"
cd bridge && pip install -r requirements.txt
python bid3_bridge.py --port /dev/cu.usbserial-XXXX     # or --keyboard

# web: live mode against the local engine (http://localhost:3000)
cd web && echo "NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:8010" > .env.local && npm install && npm run dev

# Arkiv worker: writes nothing until ARKIV_PRIVATE_KEY is set (see arkiv-worker/README.md)
cd arkiv-worker && npm install && npm start
```

With no environment set, the web app runs a labelled in-browser simulation and bundled sample Arkiv data. Every page shows which source it's using: Live, Simulation, From Arkiv or Sample data.

## Hardware and firmware

Two Seeed XIAO ESP32-C3 paddles and an ESP32-WROOM gateway, running firmware **V6**.

- [Firmware upload guide](firmware/START_HERE.md): wiring, board selection and all three sketches
- [Firmware overview](firmware/README.md): hardware targets, pinned build commands and source layout
- [Integration brief](firmware/INTEGRATION_BRIEF.md): gateway → USB bridge → engine
- [Bidding rules](firmware/BIDDING_RULES.md) and [validation results](firmware/VALIDATION.md)

Build with Espressif ESP32 core **3.3.12**, Arduino CLI **1.5.1**, **115200 baud** on all three boards. Keep the headers beside each sketch, and leave **Erase All Flash disabled** so enrolled identities survive.

The V6 engine policy (one faulty paddle is isolated, not the whole room) lives in `engine/bid3_engine/auction.py`. Deploy the engine from this repo: flashing the firmware alone doesn't update a cloud engine.

**Checks**, from the repository root:

```sh
python3 -m venv firmware/.venv
firmware/.venv/bin/python -m pip install -r firmware/requirements-dev.txt
firmware/.venv/bin/python firmware/tools/check.py
PYTHONPATH=engine firmware/.venv/bin/python -m pytest engine/tests -q
node arkiv-worker/scripts/check-schemas.mjs
```

[GitHub Actions](https://github.com/KevStatic/Bid3/actions/workflows/firmware.yml) runs the firmware host checks, the engine tests and all three board builds. Compiling and host tests don't replace physical RF, timing and hardware checks.

## What we built at Mumbai, and what we reused

All code in this repo was written at ETHGlobal Mumbai, including the paddle and gateway firmware. We reused only public libraries, one open-licensed font, and off-the-shelf hardware.

| Built at ETHGlobal Mumbai | Reused (public, not project-specific) |
|---|---|
| The auction engine, the bridge and its serial protocol, the web app | Libraries: Next.js, React, FastAPI, the Arkiv SDK, viem, wagmi and the rest of each `package.json` / `requirements.txt` |
| Everything Arkiv: schemas, worker, every read in the web app, the browser checks | Firmware platform: Arduino with the Espressif ESP32 core (BLE, mbedTLS, FreeRTOS, Wire, Preferences) |
| Paddle and gateway firmware (`firmware` branch): radio protocol, signed button presses, auction display and sounds | Font: Adafruit GFX classic 5×7 font, BSD licence (`firmware/FONT_LICENSE.txt`) |
| | Hardware: Seeed XIAO ESP32-C3 boards (paddles) and an ESP32-WROOM board (gateway) |

> **TODO (Kev): confirm with whoever wrote the firmware, then replace this box with one line.**
> - Some firmware files read like older work: `BagTrailTag.h` ("original identity/NVS and legacy proof v1 retained"), `LEGACY_TAG_PROTOCOL.md` ("BagTrail … protocol v1"), and `firmware/README.md` ("reuses the original owner-tested BLE advertisement format").
> - If that BagTrail code was written here before we pivoted to auctions (the log says BagTrail was dropped in Friday's 01:30–03:15 planning), add: *"BagTrail was our first idea at this event; the paddle firmware started as its BLE tag, which is why some files say BagTrail or legacy."*
> - If any of it existed before the event, this section must say so instead (ETHGlobal rules: undisclosed prior work can disqualify).

**Commit history.** The first commits are large: the web app (09:02), the backend (09:53) and the firmware (10:42), all on Fri 6 Nov. Each was built in the hours before it was committed. [`PROJECT_LOG.md`](PROJECT_LOG.md) records when each piece was planned and built, and later work is committed in smaller steps.

## Measured latency

> **TODO (Kev):** press-to-acknowledgement on real hardware (median and worst of N presses), and the countdown length we settled on.

## How we used AI

> **TODO (Kev): check this is accurate before submitting.** ETHGlobal's Mumbai rules:
> - AI must "assist your development process, not … create the entire project".
> - Document "where and how AI tools were used".
> - For spec-driven work, "include all spec files, prompts, and planning artifacts" in the repo.
>
> The planning docs `PROJECT_LOG.md` refers to (`Bid3_Architecture_v2…`, `Bid3_Quick_Brief_v2…`, `understanding.md`) aren't in the repo. Their folder, `EthGlobal/Plans/`, is empty on this machine. Find them and add them, for example under `docs/plans/`.

We used Claude (Anthropic) as a coding assistant throughout:
- It wrote most of the code in `web/`, `engine/`, `bridge/` and `arkiv-worker/`, and drafted these docs, from plans and decisions the team made.
- Each AI-made change is recorded in [`PROJECT_LOG.md`](PROJECT_LOG.md).
- The team designed the product and the hardware, made the rules decisions, ran and tested every round, and reviewed and committed all code. AI tools never committed.
- **TODO (Kev):** say whether AI was used for the firmware.

## License

[MIT](LICENSE)
