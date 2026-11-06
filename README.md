# Bid3

A live auction platform with physical BLE bidder tags, an authoritative auction engine and public Arkiv records.

This release contains **V6** for the Gateway, Tag01 and Tag02, together with its matching engine policy and regression tests.

## Start here

- [Firmware upload guide](firmware/START_HERE.md): wiring, board selection and all three sketches.
- [Firmware overview](firmware/README.md): hardware targets, build commands and source layout.
- [Integration brief](firmware/INTEGRATION_BRIEF.md): gateway → USB bridge → engine.
- [Bidding rules](firmware/BIDDING_RULES.md) and [validation results](firmware/VALIDATION.md).
- [Project log](PROJECT_LOG.md): shared decisions, contracts and component run commands.

## Repository structure

| Folder | Purpose |
|---|---|
| `firmware/Gateway/` | ESP32-WROOM gateway sketch and local headers |
| `firmware/Tag01/`, `firmware/Tag02/` | Standalone XIAO ESP32-C3 sketches for the two physical tags |
| `firmware/shared/` | Canonical common headers; checks verify the sketch copies match |
| `firmware/tools/`, `firmware/previews/` | Host regressions and rendered OLED previews |
| `engine/` | Authoritative auction state machine, API, persistence and tests |
| `bridge/` | Laptop USB serial ↔ engine WebSocket bridge and tests |
| `web/` | Live room, catalogue, bidder and seller frontend |
| `arkiv-worker/`, `arkiv/` | Publication worker and public record documentation |

Firmware uses Espressif ESP32 core **3.3.12**, Arduino CLI **1.5.1** and **115200 baud** on all three boards. Keep headers beside each sketch and leave **Erase All Flash disabled** to preserve enrolled identities. Release archives, build products, local environments and raw logs are excluded from Git.

## V6 availability behavior

An intentional switch OFF displays **OFF**, removes that tag's radar presence and blocks future bids. A tag-specific fault displays **LOST** and blocks only that bidder; healthy bidders and the live countdown continue. Recovery requires authentication and a fresh admitted JOIN. Old queued presses are discarded and tag recovery does not restart the countdown.

Accepted bids remain binding after OFF or a tag fault. Gateway, bridge and engine-wide outages retain the existing whole-room pause/recovery policy. The V5 immediate button feedback, sound, static tag LEDs, keys, wiring, pricing and signed-intent format are preserved.

**Deploy the matching engine code from this version** for the isolated-fault policy. Flashing firmware alone does not update a cloud engine. The existing bridge remains compatible.

## Verification

[GitHub Actions](https://github.com/KevStatic/Bid3/actions/workflows/firmware.yml) runs the firmware host checks, engine tests and three board builds. Locally, from the repository root:

```sh
python3 -m venv firmware/.venv
firmware/.venv/bin/python -m pip install -r firmware/requirements-dev.txt
firmware/.venv/bin/python firmware/tools/check.py
PYTHONPATH=engine firmware/.venv/bin/python -m pytest engine/tests -q
node arkiv-worker/scripts/check-schemas.mjs
```

See the firmware overview for pinned Arduino build commands. Compilation and host tests do not replace physical RF, timing or hardware acceptance checks.
