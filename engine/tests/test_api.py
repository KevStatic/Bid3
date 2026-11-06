"""API tests: the bridge drives a round over WebSocket, a browser stream sees it,
and the worker drains the outbox."""

import time

import pytest
from fastapi.testclient import TestClient

from bid3_engine.api import create_app
from bid3_engine.config import Settings

ADMIN = {"Authorization": "Bearer admin-secret"}
WORKER = {"Authorization": "Bearer worker-secret"}


def make_settings(tmp_path, **overrides):
    fields = dict(
        database_path=str(tmp_path / "bid3.sqlite"),
        bridge_token="bridge-secret",
        admin_token="admin-secret",
        worker_token="worker-secret",
        cors_origins=["http://localhost:3000"],
        auto_resume=True,
        require_signatures=False,
        snapshot_interval_ms=200,
        seed_demo=True,
        seed_tags="TAG1:K7,TAG2:M4",
        seed_countdown_ms=1_000,
    )
    fields.update(overrides)
    return Settings(**fields)


@pytest.fixture()
def client(tmp_path):
    with TestClient(create_app(make_settings(tmp_path))) as c:
        yield c


@pytest.fixture()
def empty_client(tmp_path):
    """An engine with no auction at all, as when the operator opens the first lot by hand."""
    with TestClient(create_app(make_settings(tmp_path, seed_demo=False))) as c:
        yield c


def intent(ws, **fields):
    ws.send_json({"type": "intent", "intent": fields})
    while True:
        message = ws.receive_json()
        if message["type"] == "ack":
            return message


def drain(ws):
    """Everything the engine has already sent this socket: a ping's pong comes after it."""
    ws.send_json({"type": "ping"})
    messages = []
    while True:
        message = ws.receive_json()
        if message["type"] == "pong":
            return messages
        messages.append(message)


NEW_LOT = {
    "auctionId": "bid3-010",
    "listingId": "lot-010",
    "rules": {"startPriceMinor": 5_000, "stepBps": 500, "countdownMs": 10_000, "ceilingMinor": 50_000, "timeLimitMs": 600_000},
    "seats": [{"tagRef": "TAG1", "alias": "Q2"}, {"tagRef": "TAG2", "alias": "V9"}],
}


def test_health_and_seeded_auction(client):
    health = client.get("/health").json()
    assert health["activeAuctionId"] == "bid3-003" and health["bridgeConnected"] is False
    state = client.get("/auctions/bid3-003").json()["state"]
    assert state["phase"] == "LOBBY"
    assert [p["alias"] for p in state["paddles"]] == ["K7", "M4"]


def test_bridge_requires_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/bridge?token=wrong") as ws:
            ws.receive_json()


def test_operator_endpoints_require_token(client):
    assert client.post("/auctions/bid3-003/pause", json={"reason": "x"}).status_code == 401
    assert client.get("/outbox").status_code == 401


def test_full_round_over_websockets(client):
    with client.websocket_connect("/auctions/bid3-003/stream") as stream, client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        snapshot = stream.receive_json()
        assert snapshot["type"] == "snapshot" and snapshot["bids"] == []

        assert bridge.receive_json()["type"] == "state"  # gateway view on connect
        assert intent(bridge, kind="JOIN", tag="TAG1", session="a", seq=1)["result"] == "ACCEPTED"
        assert intent(bridge, kind="JOIN", tag="TAG2", session="b", seq=1)["result"] == "ACCEPTED"
        assert intent(bridge, kind="BID", tag="TAG1", session="a", seq=2)["result"] == "ACCEPTED"
        ack = intent(bridge, kind="BID", tag="TAG1", session="a", seq=3)
        assert ack["result"] == "IGNORED" and ack["reason"] == "already leading"
        assert intent(bridge, kind="BID", tag="TAG2", session="b", seq=2)["result"] == "ACCEPTED"

        # The browser stream saw both bids with the exact ladder prices.
        bids = []
        deadline = time.time() + 5
        while len(bids) < 2 and time.time() < deadline:
            message = stream.receive_json()
            if message["type"] == "bid":
                bids.append(message["bid"]["priceMinor"])
        assert bids == [10_000, 10_500]

        # Hammer falls after the 1 s seed countdown.
        sold = None
        deadline = time.time() + 5
        while sold is None and time.time() < deadline:
            message = stream.receive_json()
            if message["state"]["phase"] == "SOLD_LOCKED":
                sold = message["state"]["result"]
        assert sold == {"winnerAlias": "M4", "hammerPriceMinor": 10_500, "finalSeq": 3}

        assert intent(bridge, kind="BID", tag="TAG1", session="a", seq=4)["result"] == "CLOSED"


def test_bridge_disconnect_pauses_the_round(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        intent(bridge, kind="JOIN", tag="TAG1")
        intent(bridge, kind="JOIN", tag="TAG2")
        intent(bridge, kind="BID", tag="TAG1")
    time.sleep(0.2)
    state = client.get("/auctions/bid3-003").json()["state"]
    assert state["phase"] == "PAUSED" and state["health"]["bridge"] == "down"
    assert state["countdown"] is None

    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        time.sleep(0.1)
        assert client.get("/auctions/bid3-003").json()["state"]["phase"] == "PAUSED"  # paddles not back yet
        intent(bridge, kind="JOIN", tag="TAG1")
        intent(bridge, kind="LINK", tag="TAG2", link="OK")
        assert client.get("/auctions/bid3-003").json()["state"]["phase"] == "PAUSED"
        intent(bridge, kind="JOIN", tag="TAG2")
        time.sleep(0.1)
        state = client.get("/auctions/bid3-003").json()["state"]
        assert state["phase"] == "COUNTDOWN" and state["countdown"]["durationMs"] == 1_000


def test_malformed_intent_is_refused_not_fatal(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        ack = intent(bridge, kind="DANCE", tag="TAG1")
        assert ack["result"] == "IGNORED"
        assert intent(bridge, kind="JOIN", tag="TAG1")["result"] == "ACCEPTED"


def test_worker_drains_outbox_and_room_sees_publication(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        intent(bridge, kind="JOIN", tag="TAG1")
        intent(bridge, kind="JOIN", tag="TAG2")
        intent(bridge, kind="BID", tag="TAG1")
        time.sleep(0.4)  # let a snapshot coalesce

        items = client.get("/outbox", headers=WORKER).json()
        kinds = [i["kind"] for i in items]
        assert kinds[0] == "AuctionDefinition" and "AuctionBid" in kinds and "AuctionSnapshot" in kinds
        definition = items[0]["payload"]
        assert definition["rulesHash"].startswith("0x") and definition["listingId"] == "lot-003"

        bid = next(i for i in items if i["kind"] == "AuctionBid")
        assert bid["logicalId"] == "bid:bid3-003:1:0"
        r = client.post(f"/outbox/{bid['id']}/published", headers=WORKER, json={"entityKey": "0xabc", "txHash": "0xdef"})
        assert r.status_code == 200

        state = client.get("/auctions/bid3-003").json()["state"]
        assert state["arkiv"]["lastPublishedSeq"] == 1 and state["arkiv"]["lastPublishedAtMs"] is not None
        remaining = [i["id"] for i in client.get("/outbox", headers=WORKER).json()]
        assert bid["id"] not in remaining


def test_operator_can_create_and_open_an_auction(client):
    body = {
        "auctionId": "bid3-010",
        "listingId": "lot-010",
        "rules": {"startPriceMinor": 5_000, "stepBps": 700, "countdownMs": 8_000, "ceilingMinor": 50_000, "timeLimitMs": 600_000},
        "seats": [{"tagRef": "TAG1", "alias": "Q2"}, {"tagRef": "TAG2", "alias": "V9"}],
    }
    assert client.post("/auctions", json=body, headers=ADMIN).status_code == 201
    assert client.post("/auctions", json=body, headers=ADMIN).status_code == 400  # duplicate
    opened = client.post("/auctions/bid3-010/open", headers=ADMIN).json()["state"]
    assert opened["phase"] == "LOBBY"
    assert client.get("/health").json()["activeAuctionId"] == "bid3-010"
    journal = client.get("/auctions/bid3-010/journal", headers=ADMIN).json()
    assert {e["kind"] for e in journal} >= {"CREATED", "OPENED"}


def test_tag_fault_does_not_pause_healthy_bidder_over_bridge(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        intent(bridge, kind="JOIN", tag="TAG1", session="t1", seq=1)
        intent(bridge, kind="JOIN", tag="TAG2", session="t2", seq=1)
        intent(bridge, kind="BID", tag="TAG1", session="t1", seq=2)
        before = client.get("/auctions/bid3-003").json()["state"]
        intent(bridge, kind="LINK", tag="TAG1", link="LOST")
        state = client.get("/auctions/bid3-003").json()["state"]
        assert state["phase"] == "COUNTDOWN" and state["countdown"] == before["countdown"]
        assert state["paddles"][0]["status"] == "UNKNOWN"
        assert intent(bridge, kind="BID", tag="TAG1", session="t1", seq=3)["result"] == "IGNORED"
        assert intent(bridge, kind="BID", tag="TAG2", session="t2", seq=2, stateVersion=state["stateVersion"])["result"] == "ACCEPTED"


def test_opening_an_auction_tells_the_connected_bridge(empty_client):
    # Repro from the V4/V5 review: engine with no auction, bridge connected, then POST /auctions + /open.
    client = empty_client
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        assert drain(bridge) == []  # nothing open yet, so nothing to show
        assert intent(bridge, kind="JOIN", tag="TAG1", session="a", seq=1)["result"] == "CLOSED"

        assert client.post("/auctions", json=NEW_LOT, headers=ADMIN).status_code == 201
        assert client.post("/auctions/bid3-010/open", headers=ADMIN).status_code == 200

        # The bridge must see the new auctionId: that is what makes it send CMD=STATUS so the tags re-JOIN.
        states = [m for m in drain(bridge) if m["type"] == "state"]
        assert states, "the bridge was told nothing about the newly opened auction"
        assert states[-1]["auctionId"] == "bid3-010" and states[-1]["phase"] == "LOBBY"
        assert set(states[-1]["tags"]) == {"TAG1", "TAG2"}
        assert intent(bridge, kind="JOIN", tag="TAG1", session="a", seq=2)["result"] == "ACCEPTED"


def test_opening_a_new_lot_moves_the_connected_bridge_to_it(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        assert {m["auctionId"] for m in drain(bridge) if m["type"] == "state"} == {"bid3-003"}

        assert client.post("/auctions", json=NEW_LOT, headers=ADMIN).status_code == 201
        assert client.post("/auctions/bid3-010/open", headers=ADMIN).status_code == 200

        states = [m for m in drain(bridge) if m["type"] == "state"]
        assert states and states[-1]["auctionId"] == "bid3-010" and states[-1]["phase"] == "LOBBY"
