# Bid3 standalone backend: the engine plus (optionally) the Arkiv worker, in one container.
# Made for a Render web service, but runs on any Docker host.
#
# Build it from the REPO ROOT, so it uses exactly the engine and worker code the laptop runs:
#   docker build -f backend/Dockerfile -t bid3-backend .
# Nothing is copied into backend/ by hand: engine/ and arkiv-worker/ stay the single source of truth,
# so this backend can't drift from the section-4 contracts in PROJECT_LOG.md.

# 1) Arkiv worker dependencies (Node 22, as arkiv-worker/package.json requires).
FROM node:22-bookworm-slim AS worker
WORKDIR /worker
COPY arkiv-worker/package.json arkiv-worker/package-lock.json ./
# tsx is a runtime dependency, so --omit=dev keeps everything the worker needs.
RUN npm ci --omit=dev --no-audit --no-fund
COPY arkiv-worker/tsconfig.json ./
COPY arkiv-worker/src ./src

# 2) Engine (Python) with the worker beside it.
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY engine/requirements.txt ./engine/requirements.txt
RUN pip install --no-cache-dir -r engine/requirements.txt
COPY engine/bid3_engine ./engine/bid3_engine

# Same Debian release in both stages, so the Node binary runs here as is.
COPY --from=worker /usr/local/bin/node /usr/local/bin/node
COPY --from=worker /worker ./arkiv-worker

COPY backend/start.sh ./start.sh

# Render's free plan has no disk: this file is wiped on every restart, redeploy or spin-down.
# With a paid Render disk mounted at /data, set DATABASE_PATH=/data/bid3.sqlite instead.
# REQUIRE_TOKENS=1: this is a public host, so the engine refuses to start without its three tokens.
# Render sets PORT itself (10000 by default); the engine reads it.
ENV DATABASE_PATH=/app/data/bid3.sqlite \
    REQUIRE_TOKENS=1 \
    PORT=10000

EXPOSE 10000
CMD ["sh", "/app/start.sh"]
