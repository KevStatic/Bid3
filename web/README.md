# Bid3 web

The Next.js frontend for Bid3: a live auction run from physical paddle tags, with every listing, bid and result published to Arkiv.

## Run it

```bash
cd web
npm install
cp .env.example .env.local   # optional; defaults run without any backend
npm run dev                  # http://localhost:3000
```

With no environment set, the app runs a **labelled simulation** of the room and reads **bundled sample Arkiv entities**. Every surface shows where its numbers come from (`Live`, `Simulation`, `From Arkiv`, `Sample data`), so nothing simulated can be mistaken for hardware bidding.

```bash
npm run build && npm start   # production build
npm run lint
npx tsc --noEmit
```

## Pages

| Route | What it is | Data |
|---|---|---|
| `/` | The live lot, how a round works, recent hammer prices | Engine stream + Arkiv |
| `/room/[auctionId]` | Big-screen room: price, "going once / twice / sold", paddles, bids, health. Full-screen button for the projector | Engine stream; Arkiv snapshot if the stream drops |
| `/catalogue` | Lots with status, category, price range and sort filters, each run as an Arkiv query | Arkiv only |
| `/auction/[id]/bids` | Every accepted bid as its own Arkiv entity, frozen rules, outcome | Arkiv only |
| `/explorer` | Results checked in the browser: issuer wallet, rules hash, bid history | Arkiv only, no engine calls |
| `/seller` | Five steps: item (written from the seller's wallet), rules with a live bid ladder, paddles, readiness, open | Wallet + Arkiv |
| `/seat/[alias]` | Phone page the tag's NFC sticker opens: your status, current bid, how to bid, what the light means | Engine stream |

### Simulation controls (room page)

When no engine is connected, the room plays a scripted round. Click **Take over** to drive it yourself:

- `1` / `2`: press BID on paddle one / two
- `Q` / `W`: flip paddle one / two's switch

## How it's built

- **Next.js 16** (App Router, Cache Components on), **React 19**, **Tailwind CSS 4**, TypeScript.
- **Archivo** (variable, self-hosted): expanded for headings, condensed for prices. All design tokens live in `src/app/globals.css`, with light and dark themes.
- **Arkiv** via `@arkiv-network/sdk`. The five entity schemas in `src/lib/arkiv/schemas.ts` are the single source of truth; the Arkiv worker should import them too.
- **Wallet** via wagmi + viem (injected wallet on the Rabdi testnet). Sellers sign their own `ItemListing` writes; the publisher key never reaches the browser.

```
src/
  app/                 routes (each page is a thin server shell around a client view)
  components/          ui primitives, header/footer, auction board pieces, tag drawing
  lib/
    types.ts           engine <-> web message contract (keep in sync with the engine)
    pricing.ts         exact BigInt bid ladder: price(n) = start × (1 + step)^n, rounded half up
    rules-hash.ts      canonical rules JSON + sha256 (the engine must hash identically)
    simulator.ts       in-browser engine stand-in, same rules as the real engine
    use-auction-stream.ts   WebSocket stream with reconnect, or the simulator
    arkiv/             schemas, live reader, sample reader, listing writer, query text
```

## Contract with the engine

The room subscribes to `WS {NEXT_PUBLIC_ENGINE_WS_URL}/auctions/{id}/stream` and expects the `StreamMessage` shapes in `src/lib/types.ts`:

- `snapshot` on connect (full state plus bids)
- `state` on every change
- `bid` on every accepted bid

Money is integer minor units (11576 = 115.76), times are engine-clock epoch ms, and the countdown deadline is the engine's. The browser never decides a winner.

The engine must also match two things exactly:

- **Pricing:** `src/lib/pricing.ts` (half-up rounding, computed from start price and bid index, capped at the ceiling).
- **Rules hash:** `src/lib/rules-hash.ts` (key order as listed, no whitespace, sha256, `0x` hex).

## Going live

1. Set `NEXT_PUBLIC_ARKIV_MODE=live`, a read-only `NEXT_PUBLIC_ARKIV_ACCESS_KEY`, and `NEXT_PUBLIC_PUBLISHER_ADDRESS`.
2. Set `NEXT_PUBLIC_ENGINE_HTTP_URL` / `NEXT_PUBLIC_ENGINE_WS_URL` to the hosted engine.
3. Deploy `web/` to Vercel (root directory `web`). Point the NFC stickers at `https://<domain>/seat/<alias>`.

Before the demo:

- **Explorer links:** confirm the Arkiv explorer's entity URL format in `explorerEntityUrl` (`src/lib/config.ts`).
- **Seller listings:** these currently use a placeholder lot number and the featured auction ID. Wire them to the engine's `POST /items` once it exists.
- **Open the round:** the button is a placeholder until the engine's `POST /auctions/{id}/open` exists.
