# Bid3 bridge

Runs on the laptop the gateway is plugged into. It reads the gateway's USB serial, sends paddle events to the engine, and writes the room's state back so the OLED, LEDs, buzzer and tags can show it. It dials out to the engine, so the laptop needs no public address.

```bash
cd bridge
pip install -r requirements.txt
python bid3_bridge.py --list-ports
python bid3_bridge.py --port /dev/cu.usbserial-0001 --engine ws://localhost:8010 --token "$BRIDGE_TOKEN"
```

Use `wss://<engine-host>` for the deployed engine. Settings can also come from `ENGINE_URL`, `BRIDGE_TOKEN`, `SERIAL_PORT` and `SERIAL_BAUD` (default 115200).

**No hardware?**
- `python bid3_bridge.py --keyboard`: type `join TAG1`, `bid TAG2`, `leave TAG1`, `lost TAG2`, `ok TAG2`.
- `python tools/fake_gateway.py`: opens a virtual serial port and plays a scripted round. Pass the printed port to `--port`.

## Serial protocol (what the gateway firmware must do)

One message per line, 115200 baud. Any other line (for example `SCAN_JSON=…`) is ignored, so existing debug output can stay.

### Gateway → bridge

```
AUCTION_EVENT_JSON={"kind":"JOIN","tag":"TAG1","session":"b7","seq":1}
AUCTION_EVENT_JSON={"kind":"BID","tag":"TAG1","session":"b7","seq":2,"stateVersion":42}
AUCTION_EVENT_JSON={"kind":"LEAVE","tag":"TAG2","session":"c1","seq":5}
AUCTION_EVENT_JSON={"kind":"LINK","tag":"TAG2","link":"LOST"}
```

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `JOIN` (switch ON), `LEAVE` (switch OFF), `BID` (button press), `LINK` (radio link `OK`/`LOST`) |
| `tag` | yes | The tag's reference. Must match the engine's seats: `TAG1`/`TAG2` by default (`SEED_TAGS`) |
| `seq` | recommended | Increments on every event from that tag. Your existing button counter works |
| `session` | recommended | Changes each time the tag boots, so a retried event is never counted twice |
| `stateVersion` | BID, optional | The last `stateVersion` the tag was told about. If a bid landed since, the press is refused as `STALE` |
| `link` | LINK only | `OK` or `LOST`. Send `LOST` when a switched-on tag disconnects, `OK` when it reconnects |

**Smallest change from your current test firmware:** where the gateway increments its button counter, print `AUCTION_EVENT_JSON={"kind":"BID","tag":"TAG1","seq":<counter>}`. Do the same for switch ON/OFF with `JOIN`/`LEAVE`.

### Bridge → gateway

```
AUCTION_STATE_JSON={"phase":"COUNTDOWN","price":11025,"next":11576,"leader":"K7","msLeft":3200,"stateVersion":42,"tags":{"TAG1":{"alias":"K7","status":"ACTIVE","leader":true},"TAG2":{"alias":"M4","status":"ACTIVE","leader":false}}}
AUCTION_ACK_JSON={"tag":"TAG1","seq":2,"kind":"BID","result":"ACCEPTED","reason":null}
CMD=STATUS
```

- **State:** prices are integer minor units (11025 = 110.25). `phase` is one of LOBBY, OPEN, COUNTDOWN, PAUSED, SOLD_LOCKED, UNSOLD, CANCELLED.
  - Drive the OLED (price, leader, seconds left), the red LED countdown pulse, and the buzzer ticks and winner tune.
  - Pass `leader` and `stateVersion` on to each tag.
- **Ack, `result`:** `ACCEPTED`, `STALE`, `IGNORED` or `CLOSED`, with a reason.
  - Map it to the tag LED: one blink accepted, two blinks leading, three fast blinks refused.
- **`CMD=STATUS`:** sent whenever the bridge (re)connects. Reply with a `JOIN` (or `LINK` `OK`) for every connected tag whose switch is ON. After any outage the engine treats paddles as "signal lost" until they re-announce, so the room stays paused until you do.

If the engine is unreachable, the bridge sends `{"phase":"PAUSED","reason":"engine offline"}` and acks every press as `CLOSED`, instead of queueing stale presses.
