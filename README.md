# Bid3

> A physical live auction where every accepted bid and the hammer result can be verified without trusting the auction organiser.

[Live app](https://bid3.vercel.app) · [Arkiv explorer](https://rabdi.explorer.arkiv.network) · [MIT license](LICENSE)

Bid3 brings the theatre of a live auction to verifiable public infrastructure. Bidders use handheld ESP32 paddles—switch on to enter, press once to bid—while a projector shows the price, leader and hammer countdown. The fast bid loop stays local; the rules, accepted bids and final result are published as Arkiv entities that anyone can query and check independently.

Built from scratch at **ETHGlobal Mumbai, 5–7 November 2026**.

## The product

Live auctions are exciting, but their audit trail is usually a private database or the auctioneer's word. Putting the bid loop directly onchain would make a room wait for transaction confirmation. Bid3 separates those concerns:

- **Physical and immediate:** no bidder app or wallet; a paddle press is the interface.
- **Deterministic:** each accepted bid moves exactly 5% up a reproducible integer price ladder.
- **Safe under failure:** one lost paddle is isolated; gateway, bridge or engine failure pauses the room.
- **Publicly verifiable:** the browser rebuilds the ladder and transcript from Arkiv, without calling the Bid3 engine.
- **Privacy-conscious:** public records use fresh per-round aliases such as `K7` and `M4`, never stable device IDs.

Bid3 is aimed at charity galas, community fundraisers, college festivals, conferences and collector events that want physical bidding with a result donors, sellers and losing bidders can inspect afterward.

## Demo

| Resource | Link |
|---|---|
| Product | [bid3.vercel.app](https://bid3.vercel.app) |
| Verified results | [Results explorer](https://bid3.vercel.app/explorer) |
| Lots | [Arkiv-backed catalogue](https://bid3.vercel.app/catalogue) |
| Demo video | Add the ETHGlobal submission video link here (maximum 3 minutes for the EF CROPS track) |

The live room needs the event laptop's engine and Cloudflare tunnel to be online. The catalogue, bid history and results explorer read Arkiv directly and remain independently queryable when that engine is offline. With no backend configuration, a local web build runs a clearly labelled simulation and sample data.

### A real hardware round

`bid3-004` ran end to end with two physical paddles and the gateway. It accepted 11 alternating bids from `100.00` to `162.89`, sold to paddle `M4`, and was read back from Arkiv with the same rules, ladder, transcript and winner.

- Result entity: [`0x6d84…1222`](https://rabdi.explorer.arkiv.network/entity/0x6d84cd90e2d8fc7a8946676f247ebf17660c9e77d54843107b0d77608c421222)
- Publisher: `0xCf11CEa33b48A48901DD2a03730524a69E64e32d`
- Full round cost: `0.00444 tGLM` on the Rabdi testnet
- Prices are **demo credits**. With payments on (`PAYMENTS=1`), the winning paddle's wallet pays the seller on the **Sepolia** testnet: tapping the paddle's NFC sticker opens the seat page, whose phone wallet links to the paddle in one tap and pays automatically at the hammer: 0 ETH at the default rate, so only gas. No real money moves. The outcome is an `AuctionSettlement` entity on Arkiv with the Sepolia transaction.

## How a round works

1. Sellers list items from their own wallets ("Sell an item"): they sign the listing for free on any network (Sepolia included, no Rabdi or tGLM needed), Bid3 writes it to Arkiv and hands ownership to the seller's wallet, and every lot appears in **Lots** for everyone. The **auctioneer** opens bidding on one lot at a time from the admin page.
2. Each bidder holds an ESP32 paddle with a **slide switch** and a **BID button**. Switch on to join the room, at any point while bidding is open; switch off to leave. **Each press bids the next price**: +5% per bid, computed with exact integer maths from the opening bid. A lone bidder wins at their bid. If nobody bids before the auctioneer's no-bid timer runs out, the lot closes unsold and goes back to its seller.
3. Every accepted bid restarts a short hammer countdown ("going once, going twice, sold"). When it ends, the leading paddle wins. Accepted bids stay binding, even if that paddle switches off or loses signal.
4. If **one paddle** loses signal, only that bidder is blocked (its display shows LOST). Everyone else, and the countdown, carry on. To come back, the paddle re-authenticates and joins again, without restarting the countdown. If the **gateway, bridge or engine** drops out, the whole room **pauses** and nothing is sold until it recovers.
5. The rules, every accepted bid and the result are written to Arkiv. The [results page](web/src/app/explorer/explorer-view.tsx) re-checks each result in your browser, reading only from Arkiv: issuer wallet, rules hash, bid count, every bid's price, and a hash of the full bid transcript.

## Architecture

```text
ESP32 paddles ──BLE──▶ gateway ──USB serial──▶ bridge ──WebSocket──▶ engine
                                                                        │
                                                       SQLite + outbox  │
                                                                        ▼
browser ◀──── live WebSocket ─────────────────────────────────────── engine
   │
   └──── public reads, no Bid3 server ──▶ Arkiv ◀──── publisher worker
```

| Component | Responsibility |
|---|---|
| [`firmware/`](firmware/) | V6 Arduino firmware for two Seeed XIAO ESP32-C3 paddles and an ESP32-WROOM gateway; signed intents, display, LEDs and sound. |
| [`bridge/`](bridge/) | USB serial ↔ engine WebSocket adapter. Refuses offline presses instead of replaying them later. Includes keyboard and fake-gateway modes. |
| [`engine/`](engine/) | The single authority for order, pricing, countdown and winner. FastAPI state machine with a SQLite journal and transactional Arkiv outbox. |
| [`arkiv-worker/`](arkiv-worker/) | Publishes frozen definitions, accepted bids, snapshots and results from the outbox to Arkiv. The auction never waits on a chain write. |
| [`web/`](web/) | Next.js 16 product: live room, catalogue, bid history, result verification, seller flow and NFC seat page. |
| [`arkiv/`](arkiv/) | Schema, judging answers and integration feedback required by the Arkiv track. |

The price formula, canonical rules hash and transcript digest are implemented independently in TypeScript and Python. Shared test vectors catch drift between the browser and engine.

## Arkiv submission

**Track:** [Build on Arkiv (from scratch)](https://ethglobal.com/events/mumbai/prizes)

Arkiv is product infrastructure here, not an attached log. Sellers own their listing entities. The catalogue, bid history and results explorer query Arkiv directly. If the Bid3 engine disappears, anyone can still retrieve the public auction record and run the verification logic.

### Writer wallet and live data

The Bid3 publisher and seeded demo seller wallet is:

```text
0xCf11CEa33b48A48901DD2a03730524a69E64e32d
```

At the time of this README audit it owned four live `AuctionResult` entities: `bid3-004` through `bid3-007`. The public query returned two 11-bid hardware results plus later 4- and 5-bid results.

Run the same query without a Bid3 server or private key:

```bash
cd arkiv-worker
npm install
npm run query-results -- 0xCf11CEa33b48A48901DD2a03730524a69E64e32d
```

The script executes the equivalent of:

```ts
client
  .select()
  .from(AuctionResult)
  .ownedBy(publisher)
  .orderBy(desc("closedAtMs"))
  .limit(20)
  .fetch();
```

### What lives on Arkiv

| Entity | Owner | Lifetime | User-visible purpose |
|---|---|---:|---|
| `ItemListing` | Seller wallet | close + 24 h | Catalogue and lot details |
| `AuctionDefinition` | Publisher | 30 days | Frozen rules used by browser verification |
| `AuctionBid` | Publisher | 7 days | Ordered accepted-bid history |
| `AuctionSnapshot` | Publisher | 10 minutes | Public fallback while the live stream is unavailable |
| `AuctionResult` | Publisher | 90 days, permissionlessly extendable | Winner, hammer price and verification anchor |

Rules, bids and results are `readonly`, but Arkiv still permits their owner to delete them. Bid3 states that limitation rather than describing the records as permanent: deletion becomes visible as missing evidence, while an in-place edit is prevented.

Judge documentation:

- [Schema, indexed fields, owners and expiration](arkiv/schema.md)
- [How Arkiv features change the product](arkiv/how-you-use-arkiv.md)
- [Why users would lose this verification model with Postgres](arkiv/why-arkiv.md)
- [Reach and intended users](arkiv/reach.md)
- [Integration friction and reproducible feedback](arkiv/friction.md)

## CROPS

**Ethereum Foundation track:** [Best CROPS App: Censorship Resistant, Open Source, Private, Secure](https://ethglobal.com/events/mumbai/prizes)

### C — Censorship resistant

The live auction still depends on one Bid3 engine, the event laptop and its network path; if any of those refuse service or disappear, bidding stops safely rather than pretending to continue. The durable part is independent: listings, accepted bids, rules and results are public Arkiv entities, and the explorer/query script works without the Bid3 server or domain. The frontend is currently hosted on one Vercel domain, so a fully redundant or content-addressed frontend remains future work.

### O — Open source

The full web, engine, bridge, worker and firmware source is available in this repository under the [MIT license](LICENSE). A user can build and run the system from the repository alone with public dependencies; physical mode additionally needs the listed off-the-shelf ESP32 boards. Exact setup commands are below and component-specific details live in each folder's README.

### P — Private

Bid3 has no third-party analytics or client trackers. Arkiv records are intentionally public and reveal the lot, price, timestamps and fresh per-round paddle alias. They do **not** contain a person's name, wallet, stable paddle identifier or radio device ID. The engine and bridge do see the enrolled device reference, and infrastructure providers can observe normal network metadata such as IP addresses and RPC queries. A seller who publishes from a wallet publicly links that wallet to the listing.

### S — Secure

Paddle JOIN, LEAVE and BID intents are signed with enrolled secp256k1 keys and verified by the engine when `INTENT_SIGNATURES_REQUIRED=1`. Private keys remain in device storage or server environments; the publisher key never belongs in a `NEXT_PUBLIC_*` variable. Separate bridge, worker and admin tokens protect control paths, accepted intents are journalled, and browser verification detects rule or transcript mismatch. Current trust limits: the engine is the live authority, the publisher can delete its Arkiv entities, and the V1 paddle signature does not bind `auctionId` or `epoch`, so operators must run one active lot and drain pending intents before switching rounds.

The lead CROPS property is **censorship-resistant access to the completed auction record**: turning off the Bid3 backend removes live bidding but not the ability to retrieve and verify already-published outcomes. No Anon-RPC or EIP-8141 alternative-mempool integration is claimed.

## Run locally

### Software-only demo

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. With no environment file, the UI explicitly labels its auction as **Simulation** and its Arkiv records as **Sample data**.

### Full stack

```bash
# terminal 1 — engine, http://localhost:8010
cd engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m bid3_engine

# terminal 2 — bridge (use --keyboard when no hardware is attached)
cd bridge
pip install -r requirements.txt
python bid3_bridge.py --keyboard --engine ws://localhost:8010

# terminal 3 — web
cd web
npm install
NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:8010 npm run dev

# terminal 4 — Arkiv publisher; dry-run unless ARKIV_PRIVATE_KEY is configured
cd arkiv-worker
npm install
ENGINE_URL=http://localhost:8010 npm start
```

Windows PowerShell users can set environment variables with `$env:NAME="value"` before running the command. For physical hardware, flashing instructions, pinned toolchain versions and wiring are in [`firmware/START_HERE.md`](firmware/START_HERE.md).

### Checks

```bash
cd engine && python -m pytest
cd ../arkiv-worker && npm run typecheck && npm run check-schemas
cd ../web && npm run lint && npx tsc --noEmit
```

Firmware validation and three-board build commands are documented in [`firmware/VALIDATION.md`](firmware/VALIDATION.md).

## Hackathon disclosure

### Built at ETHGlobal Mumbai

The team's declaration is that Bid3 was started and built during ETHGlobal Mumbai, including:

- the physical auction concept and rules;
- the Next.js product and browser-side verification;
- the Python engine, SQLite journal and outbox;
- the serial/WebSocket bridge and test harnesses;
- the Arkiv schemas, writer, queries and judging documentation;
- the paddle and gateway auction firmware.

The firmware retains names such as `BagTrail` and `legacy` because BagTrail was the team's first concept during this event before it pivoted to auctions. They describe internal lineage within the hackathon project, not a separately submitted product. If any project-specific firmware is later found to predate the event, the team must correct this disclosure and notify ETHGlobal before judging.

### Reused public work

- Open-source dependencies declared in `package.json` and `requirements*.txt`, including Next.js, React, FastAPI, Arkiv SDK, viem and wagmi.
- Arduino and Espressif ESP32 core libraries: BLE, mbedTLS, FreeRTOS, Wire and Preferences.
- Adafruit GFX classic 5×7 font under its BSD license ([attribution](firmware/FONT_LICENSE.txt)).
- Off-the-shelf Seeed XIAO ESP32-C3 paddles and ESP32-WROOM gateway hardware.

No pre-existing project-specific code, design or asset is intentionally claimed as part of this from-scratch submission.

### AI use

Claude and Codex were used as coding and documentation assistants across the web app, engine, bridge, Arkiv worker, firmware tests and project documentation. The human team selected the product, architecture and auction rules; supplied and tested the hardware; evaluated failures; reviewed the output; and controlled what was merged and submitted. AI assistance and significant decisions are recorded chronologically in [`PROJECT_LOG.md`](PROJECT_LOG.md). AI-generated voiceover is not used in the demo video.

## Current limitations

- Payments are Sepolia testnet transactions (0 ETH by default) with no escrow: the winner's phone pays automatically after the hammer from a wallet kept in the phone's browser, and a lot that isn't paid within 10 minutes stays with the seller.
- The live round has one central engine and supports one active lot at a time.
- V1 signed intents do not bind the auction ID or epoch; operational draining is required between lots.
- Publisher-owned Arkiv entities are immutable in content but still deletable by that owner.
- The deployed live engine uses an event-laptop Cloudflare quick tunnel and may be offline outside the demo window.
- Seller onboarding and opening a round still require operator involvement.
- Real press-to-engine-ack latency has not yet been published as a measured benchmark; the 10-second hammer countdown is confirmed for hardware rounds.

## License

[MIT](LICENSE)
