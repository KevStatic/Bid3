"""Paddle wallets and Sepolia payments (payments.py): who pays, when the lot stays with the seller,
and that none of it changes a round when PAYMENTS is off."""

import time

import pytest
from fastapi.testclient import TestClient

from bid3_engine.api import create_app
from bid3_engine.payments import Payments, PaymentError
from bid3_engine.store import Store

from test_api import ADMIN, WORKER, empty_client, intent, make_settings  # noqa: F401 (fixture)

WINNER = "0x" + "a1" * 20
OTHER = "0x" + "b2" * 20
SELLER = "0x" + "c3" * 20
TX = "0x" + "d4" * 32


def payments(enabled=True, rate=0, window_ms=60_000):
    return Payments(Store(":memory:"), enabled, rate, window_ms)


# ------------------------------------------------------------ unit


def test_a_sold_lot_owes_the_seller_at_the_rate():
    p = payments(rate=10**12)  # 0.000001 ETH per credit
    p.set_payee("lot", SELLER)
    p.bind("K7", WINNER, 0, set())
    assert p.on_sold("lot", 1, "K7", 29_699, 1_000) is None  # due, not final yet
    due = p.view("lot")
    assert due["status"] == "DUE" and due["payer"] == WINNER and due["payee"] == SELLER
    assert due["amountWei"] == str(29_699 * 10**12 // 100) and due["memo"] == "bid3:lot"


def test_rate_defaults_to_zero_and_the_admin_value_wins():
    p = payments()
    assert p.wei_per_credit() == 0
    p.set_wei_per_credit(5)
    assert p.wei_per_credit() == 5 and p.settings_view()["weiPerCredit"] == "5"
    with pytest.raises(PaymentError):
        p.set_wei_per_credit(-1)


def test_no_seller_wallet_means_unpaid_at_once():
    p = payments()
    p.bind("K7", WINNER, 0, set())
    kind, logical_id, payload = p.on_sold("lot", 1, "K7", 10_000, 1_000)
    assert kind == "AuctionSettlement" and logical_id == "settlement:lot:1"
    assert payload["status"] == "UNPAID" and payload["reason"] == "The lot has no seller wallet on file"


def test_a_winner_without_a_wallet_can_link_one_after_the_hammer():
    p = payments()
    p.set_payee("lot", SELLER)
    p.on_sold("lot", 1, "K7", 10_000, 1_000)
    assert p.view("lot")["payer"] is None
    p.bind("K7", WINNER, 2_000, locked=set())
    assert p.view("lot")["payer"] == WINNER


def test_paid_only_from_the_linked_wallet_to_the_seller_in_time():
    p = payments(rate=100)
    p.set_payee("lot", SELLER)
    p.bind("K7", WINNER, 0, set())
    p.on_sold("lot", 1, "K7", 10_000, 1_000)  # 10_000 wei due
    for payer, payee, amount, why in [
        (OTHER, SELLER, 10_000, "linked to the winning paddle"),
        (WINNER, OTHER, 10_000, "seller's wallet"),
        (WINNER, SELLER, 9_999, "less than the amount due"),
    ]:
        with pytest.raises(PaymentError, match=why):
            p.mark_paid("lot", TX, payer, payee, amount, 2_000)
    with pytest.raises(PaymentError, match="window has closed"):
        p.mark_paid("lot", TX, WINNER, SELLER, 10_000, 1_000 + 60_001)
    kind, _, payload = p.mark_paid("lot", TX, WINNER.upper().replace("0X", "0x"), SELLER, 10_000, 2_000)
    assert payload["status"] == "PAID" and payload["txHash"] == TX and payload["payer"] == WINNER
    with pytest.raises(PaymentError, match="already recorded"):
        p.mark_paid("lot", TX, WINNER, SELLER, 10_000, 2_500)


def test_one_transaction_pays_for_one_lot_only():
    p = payments()
    for lot in ("a", "b"):
        p.set_payee(lot, SELLER)
    p.bind("K7", WINNER, 0, set())
    p.on_sold("a", 1, "K7", 100, 1_000)
    p.on_sold("b", 1, "K7", 100, 1_000)
    p.mark_paid("a", TX, WINNER, SELLER, 0, 2_000)
    with pytest.raises(PaymentError, match="another lot"):
        p.mark_paid("b", TX, WINNER, SELLER, 0, 2_000)


def test_unpaid_after_the_window_and_the_lot_stays_with_the_seller():
    p = payments(window_ms=1_000)
    p.set_payee("lot", SELLER)
    p.on_sold("lot", 1, "K7", 100, 1_000)
    assert p.expire_due(2_000) == []
    [(_, _, payload)] = p.expire_due(2_001)
    assert payload["status"] == "UNPAID" and payload["reason"] == "Paddle K7 never linked a wallet"
    assert p.expire_due(9_999) == []  # final


def test_a_paddle_wallet_is_locked_while_it_matters():
    p = payments()
    p.bind("K7", WINNER, 0, set())
    with pytest.raises(PaymentError, match="can't change"):
        p.bind("K7", OTHER, 1, locked={"K7"})
    with pytest.raises(PaymentError, match="linked to Paddle K7"):
        p.bind("M4", WINNER, 1, locked={"K7"})
    with pytest.raises(PaymentError):
        p.clear("K7", locked={"K7"})
    # Not locked: the wallet moves to the other paddle (one wallet, one paddle).
    p.bind("M4", WINNER, 2, set())
    assert p.bindings() == {"M4": {"wallet": WINNER, "boundAtMs": 2}}


def test_payments_off_records_nothing():
    p = payments(enabled=False)
    p.set_payee("lot", SELLER)
    assert p.on_sold("lot", 1, "K7", 100, 1_000) is None and p.view("lot") is None


# ------------------------------------------------------------ over the API


@pytest.fixture()
def paying_client(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, seed_demo=False, payments_enabled=True, payment_window_ms=60_000))) as c:
        yield c


LOT = {
    "auctionId": "bid3-pay",
    "listingId": "lot-pay",
    "rules": {"startPriceMinor": 10_000, "stepBps": 500, "countdownMs": 1_000, "ceilingMinor": 100_000, "timeLimitMs": 600_000},
    "seats": [{"tagRef": "TAG1", "alias": "K7"}, {"tagRef": "TAG2", "alias": "M4"}],
    "sellerAddress": SELLER,
}


def sell_to_k7(client):
    with client.websocket_connect("/bridge?token=bridge-secret") as bridge:
        bridge.receive_json()
        assert intent(bridge, kind="JOIN", tag="TAG1")["result"] == "ACCEPTED"
        assert intent(bridge, kind="BID", tag="TAG1")["result"] == "ACCEPTED"
        # K7 has bid on the live lot, so its wallet is locked until the payment is settled.
        assert client.get("/bindings").json()["K7"]["locked"] is True
        assert client.post("/bindings", headers=ADMIN, json={"alias": "K7", "wallet": OTHER}).status_code == 409
        deadline = time.time() + 5
        while client.get("/auctions/bid3-pay").json()["state"]["phase"] != "SOLD_LOCKED" and time.time() < deadline:
            time.sleep(0.05)


def test_full_payment_over_the_api(paying_client):
    c = paying_client
    assert c.get("/payments/settings").json() == {"enabled": True, "weiPerCredit": "0", "windowMs": 60_000, "chainId": 11155111}
    assert c.post("/payments/settings", json={"weiPerCredit": "7"}).status_code == 401
    assert c.post("/payments/settings", headers=ADMIN, json={"weiPerCredit": "0"}).status_code == 200

    assert c.post("/bindings", json={"alias": "K7", "wallet": WINNER}).status_code == 401
    assert c.post("/bindings", headers=ADMIN, json={"alias": "K7", "wallet": WINNER}).status_code == 200
    assert c.post("/auctions", headers=ADMIN, json=LOT).status_code == 201
    assert c.post("/auctions/bid3-pay/open", headers=ADMIN).status_code == 200
    assert c.get("/auctions/bid3-pay/payment").status_code == 404

    sell_to_k7(c)
    due = c.get("/auctions/bid3-pay/payment").json()
    assert due["status"] == "DUE" and due["payer"] == WINNER and due["payee"] == SELLER and due["amountWei"] == "0"
    assert c.get("/auctions").json()[0]["payment"]["status"] == "DUE"
    assert c.get("/bindings").json()["K7"]["locked"] is True  # owes a payment

    paid = {"txHash": TX, "payer": WINNER, "payee": SELLER, "amountWei": "0"}
    assert c.post("/auctions/bid3-pay/payment/paid", json=paid).status_code == 401
    assert c.post("/auctions/bid3-pay/payment/paid", headers=ADMIN, json={**paid, "payer": OTHER}).status_code == 409
    response = c.post("/auctions/bid3-pay/payment/paid", headers=ADMIN, json=paid)
    assert response.status_code == 200 and response.json()["status"] == "PAID"
    assert c.get("/bindings").json()["K7"]["locked"] is False

    settlements = [r for r in c.get("/outbox?limit=100", headers=WORKER).json() if r["kind"] == "AuctionSettlement"]
    assert [(r["logicalId"], r["payload"]["status"], r["payload"]["txHash"]) for r in settlements] == [("settlement:bid3-pay:1", "PAID", TX)]


def test_payments_off_keeps_rounds_as_they_were(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, seed_demo=False))) as c:
        assert c.post("/auctions", headers=ADMIN, json=LOT).status_code == 201
        assert c.post("/auctions/bid3-pay/open", headers=ADMIN).status_code == 200
        with c.websocket_connect("/bridge?token=bridge-secret") as bridge:
            bridge.receive_json()
            intent(bridge, kind="JOIN", tag="TAG1")
            intent(bridge, kind="BID", tag="TAG1")
            deadline = time.time() + 5
            while c.get("/auctions/bid3-pay").json()["state"]["phase"] != "SOLD_LOCKED" and time.time() < deadline:
                time.sleep(0.05)
        assert c.get("/auctions/bid3-pay").json()["state"]["result"]["winnerAlias"] == "K7"
        assert c.get("/auctions/bid3-pay/payment").status_code == 404
        assert c.get("/auctions").json()[0]["payment"] is None
        assert not [r for r in c.get("/outbox?limit=100", headers=WORKER).json() if r["kind"] == "AuctionSettlement"]


# ------------------------------------------------------------ seller listings (written to Arkiv by the publisher)

LISTING = {
    "listingId": "lot-abc", "auctionId": "bid3-abc", "lotNumber": 20, "title": "Water bottle", "category": "Other",
    "condition": "Works perfectly", "description": "Nice bottle of water.", "sellerAlias": "Seller 8cdf",
    "sellerAddress": "0x" + "8C" * 20, "startPriceMinor": 4_000, "closesAtMs": 1_800_000_000_000, "signature": "0x" + "ab" * 65,
}


def test_a_signed_listing_is_queued_for_arkiv_once(empty_client):
    c = empty_client
    assert c.post("/listings", json=LISTING).status_code == 401
    assert c.post("/listings", headers=ADMIN, json={**LISTING, "title": "x"}).status_code == 422
    assert c.post("/listings", headers=ADMIN, json={**LISTING, "sellerAddress": "nope"}).status_code == 422
    assert c.post("/listings", headers=ADMIN, json=LISTING).status_code == 202
    assert c.post("/listings", headers=ADMIN, json=LISTING).status_code == 409
    [record] = [r for r in c.get("/outbox?limit=100", headers=WORKER).json() if r["kind"] == "ItemListing"]
    assert record["logicalId"] == "listing:lot-abc" and record["auctionId"] == "bid3-abc"
    assert record["payload"]["sellerAddress"] == "0x" + "8c" * 20 and record["payload"]["status"] == "UPCOMING"
    assert c.get("/listings/lot-abc").json()["published"] is False
    assert c.post(f"/outbox/{record['id']}/published", headers=WORKER, json={"entityKey": "0xkey", "txHash": "0xtx"}).status_code == 200
    status = c.get("/listings/lot-abc").json()
    assert status["published"] is True and status["entityKey"] == "0xkey"
    assert c.get("/listings/nope").status_code == 404
