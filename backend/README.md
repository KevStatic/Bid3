# Bid3 backend (standalone, on Render)

Bid3's backend as one Docker service that runs without the laptop:

- **Engine** (always on): the FastAPI auction authority. It handles the rules, live WebSocket stream, admin calls, payments API and Arkiv outbox. This is the same code as `engine/`.
- **Arkiv worker** (optional): drains the engine's outbox into Arkiv entities. This is the same code as `arkiv-worker/`, and it starts only when `ARKIV_PRIVATE_KEY` is set.

This folder holds only the deployment files. The image is built from the repo root and copies `engine/` and `arkiv-worker/` as they are, so this backend always runs the same code and contracts as the laptop. It never runs a drifted copy.

**What it doesn't change:** the live demo. `bid3.vercel.app` keeps talking to the laptop engine through the tunnel, because the paddles' gateway is plugged into the laptop. Nothing in `engine/`, `bridge/`, `arkiv-worker/` or `web/` was modified for this.

| File | What it does |
|---|---|
| `Dockerfile` | Two stages: Node 22 installs the worker's packages, then Python 3.12 runs the engine with the worker beside it |
| `start.sh` | Starts the engine. It also starts the worker (restarted if it stops) when `ARKIV_PRIVATE_KEY` is set and isn't the laptop's publisher key |
| `render.yaml` | Render Blueprint: free Docker web service in Singapore, health check `/health`, generated tokens |
| `.env.example` | Every variable to set, with notes |
| `Dockerfile.dockerignore` | Keeps `.env` files, databases and `node_modules` out of local builds |

## Deploy on Render

**A. Blueprint:** In Render, choose New → Blueprint and pick this repo. Set the Blueprint path to `backend/render.yaml`. Render creates `bid3-backend` and generates the three tokens.

**B. By hand:** Choose New → Web Service and pick this repo, then set:

| Setting | Value |
|---|---|
| Language | Docker |
| Branch | `main` |
| Region | Singapore |
| Root Directory | *(leave empty)* |
| Dockerfile Path | `./backend/Dockerfile` |
| Docker Build Context Directory | `.` |
| Health Check Path | `/health` |
| Instance type | Free |

Then add the variables below under Environment.

## Environment variables

| Variable | Value | Needed |
|---|---|---|
| `BRIDGE_TOKEN` | random, e.g. `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` | yes |
| `ADMIN_TOKEN` | random (a different value) | yes |
| `WORKER_TOKEN` | random (a different value) | yes |
| `CORS_ORIGINS` | `https://bid3.vercel.app,http://localhost:3000` | yes |
| `REQUIRE_TOKENS` | `1` (already the image default) | recommended |
| `SEED_DEMO` | `1`, so demo lot `bid3-003` exists on every fresh start; `0` if the worker is on | recommended |
| `SEED_COUNTDOWN_MS` | `10000` (same 10 s hammer as the hardware rounds) | recommended |
| `ARKIV_PRIVATE_KEY` | a **new** wallet's key with a little tGLM; turns the worker on | optional |
| `ARKIV_ACCESS_KEY` | Arkiv access key (the public endpoint is heavily rate limited without one) | optional, with the worker |

Use new token values, not the ones in `engine/.env`. Don't set `PORT` (Render sets it), `DATABASE_PATH` (the image sets it) or `PAYMENTS` (the site's payment flow talks to the laptop engine).

**Never use the laptop's publisher key here.** Two workers on one key race each other for nonces, and this backend's test lots would show up among the live site's verified results. `start.sh` refuses the key for `0xCf11…e32d` and runs the engine alone.

## Check it

```bash
curl https://bid3-backend.onrender.com/health      # {"ok":true,"activeAuctionId":"bid3-003",...}
curl https://bid3-backend.onrender.com/auctions    # the lots and their phase
```

The live stream is `wss://bid3-backend.onrender.com/auctions/bid3-003/stream`. Every endpoint is listed in `engine/README.md`. Use your service's real URL if Render gives it a suffix.

## Run a round on it (optional)

A bridge can dial this backend from any laptop. The keyboard bridge needs no hardware:

```bash
cd bridge && python bid3_bridge.py --keyboard --engine wss://bid3-backend.onrender.com --token <render BRIDGE_TOKEN>
# then type: join TAG1, join TAG2, bid TAG1, bid TAG2 ...
```

The real gateway works the same way with `--port /dev/cu.usbserial-<n>` instead of `--keyboard`. Leave signatures off here: the seeded lot has no enrolled keys.

## Limits of Render's free plan

- It **spins down after 15 minutes without traffic**, and the next request takes about a minute to wake it.
- It has **no disk**, so the SQLite database is wiped on every spin-down, restart or redeploy. With `SEED_DEMO=1` the demo lot comes back each time. A paid Render disk at `/data` with `DATABASE_PATH=/data/bid3.sqlite` keeps it.
- Keep it to **one instance**: the engine must be the only authority.
- Anything the worker wrote to Arkiv stays there, readable without this server.

## Test locally

```bash
docker build -f backend/Dockerfile -t bid3-backend .     # from the repo root
cp backend/.env.example backend/.env                     # fill in the tokens (gitignored)
docker run --rm -p 8097:10000 --env-file backend/.env bid3-backend
curl localhost:8097/health
```

Don't map it to port 8010: that's the laptop engine.
