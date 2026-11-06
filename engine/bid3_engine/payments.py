"""Paddle wallets and Sepolia payments.

Kept apart from auction.py on purpose: nothing here changes how a lot is bid on or who wins.

- A bidder taps a paddle's NFC sticker and links their wallet to that paddle. The website checks the
  wallet's signature, then calls POST /bindings with the admin token.
- When a lot sells, a payment becomes DUE: the winner's linked wallet pays the seller's wallet on
  Sepolia, `weiPerCredit` wei per 1.00 credit of the hammer price. The rate is 0 by default, so a
  payment is a 0 ETH transaction and only gas is spent. The admin page can change it at any time;
  each payment keeps the rate it was due at.
- The website checks the Sepolia transaction and reports it with POST /auctions/{id}/payment/paid.
- Without a valid payment before the window ends, the payment is UNPAID and the lot stays with the
  seller. A lot with no seller wallet on file is UNPAID at once.
- PAID and UNPAID are final, and each queues an AuctionSettlement record for Arkiv.

A paddle's wallet can't be swapped while it matters: once the paddle has bid on the live lot, or
while it owes a payment. A paddle with no wallet yet can always be linked, even after it won.
"""

from __future__ import annotations

import re
from typing import Any

from .store import Store

SEPOLIA_CHAIN_ID = 11155111
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
TX_HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")
RATE_KEY = "payments.weiPerCredit"


class PaymentError(Exception):
    """A refused request. The message is shown to the user as is."""


def memo_for(auction_id: str) -> str:
    """The text a payment carries as its transaction data, tying it to one lot."""
    return f"bid3:{auction_id}"


class Payments:
    def __init__(self, store: Store, enabled: bool, default_wei_per_credit: int = 0, window_ms: int = 10 * 60_000):
        self.store = store
        self.enabled = enabled
        self.default_wei_per_credit = default_wei_per_credit
        self.window_ms = window_ms

    # ------------------------------------------------------------ settings

    def wei_per_credit(self) -> int:
        stored = self.store.get_setting(RATE_KEY)
        return int(stored) if stored is not None else self.default_wei_per_credit

    def set_wei_per_credit(self, value: int) -> None:
        if value < 0:
            raise PaymentError("The rate can't be negative.")
        self.store.set_setting(RATE_KEY, str(value))

    def settings_view(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "weiPerCredit": str(self.wei_per_credit()),
            "windowMs": self.window_ms,
            "chainId": SEPOLIA_CHAIN_ID,
        }

    # ------------------------------------------------------------ bindings

    def bindings(self) -> dict[str, dict[str, Any]]:
        return {row["alias"]: {"wallet": row["wallet"], "boundAtMs": row["bound_at_ms"]} for row in self.store.bindings()}

    def bind(self, alias: str, wallet: str, now_ms: int, locked: set[str]) -> None:
        """Links `wallet` to the paddle `alias`. `locked` are the paddles whose wallet can't change now."""
        if not ADDRESS.match(wallet):
            raise PaymentError("That isn't a wallet address.")
        wallet = wallet.lower()
        current = self.bindings()
        mine = current.get(alias)
        if mine and mine["wallet"] == wallet:
            self._fill_missing_payer(alias, wallet)
            return
        if mine and alias in locked:
            raise PaymentError(f"Paddle {alias} has bid on this lot or owes a payment, so its wallet can't change until that's settled.")
        for other, binding in current.items():
            if other != alias and binding["wallet"] == wallet and other in locked:
                raise PaymentError(f"This wallet is linked to Paddle {other}, which has bid on this lot or owes a payment.")
        self.store.set_binding(alias, wallet, now_ms)  # also unlinks the wallet from any other paddle
        self._fill_missing_payer(alias, wallet)

    def clear(self, alias: str, locked: set[str]) -> None:
        if alias in locked:
            raise PaymentError(f"Paddle {alias} has bid on this lot or owes a payment, so its wallet stays until that's settled.")
        self.store.clear_binding(alias)

    def owing_aliases(self) -> set[str]:
        """Paddles with a DUE payment and a wallet on it: their wallet must not change."""
        return {p["winner_alias"] for p in self.store.payments(status="DUE") if p["payer"]}

    def _fill_missing_payer(self, alias: str, wallet: str) -> None:
        # A winner who links a wallet after the hammer can still pay within the window.
        for p in self.store.payments(status="DUE"):
            if p["winner_alias"] == alias and not p["payer"]:
                self.store.update_payment(p["auction_id"], payer=wallet)

    # ------------------------------------------------------------ payees

    def set_payee(self, auction_id: str, seller: str) -> None:
        if not ADDRESS.match(seller):
            raise PaymentError("The seller address isn't a wallet address.")
        self.store.set_payee(auction_id, seller.lower())

    # ------------------------------------------------------------ payments

    def on_sold(self, auction_id: str, epoch: int, winner_alias: str, hammer_price_minor: int, now_ms: int) -> tuple[str, str, dict[str, Any]] | None:
        """Called once when a lot sells. Returns the Arkiv record if the payment is already final."""
        if not self.enabled or self.store.payment(auction_id) is not None:
            return None
        payer = self.bindings().get(winner_alias, {}).get("wallet")
        payee = self.store.payee(auction_id)
        amount = hammer_price_minor * self.wei_per_credit() // 100
        status, reason = ("DUE", None) if payee else ("UNPAID", "The lot has no seller wallet on file")
        self.store.insert_payment(
            {
                "auction_id": auction_id,
                "epoch": epoch,
                "winner_alias": winner_alias,
                "hammer_price_minor": hammer_price_minor,
                "payer": payer,
                "payee": payee,
                "amount_wei": str(amount),
                "status": status,
                "reason": reason,
                "due_by_ms": now_ms + self.window_ms,
                "created_at": now_ms,
                "settled_at": now_ms if status != "DUE" else None,
            }
        )
        return self.settlement_record(auction_id) if status != "DUE" else None

    def mark_paid(self, auction_id: str, tx_hash: str, payer: str, payee: str, amount_wei: int, now_ms: int) -> tuple[str, str, dict[str, Any]]:
        """Records a Sepolia transaction the website has checked. Returns the Arkiv record."""
        p = self.store.payment(auction_id)
        if p is None:
            raise PaymentError("No payment is due for this lot.")
        if p["status"] == "PAID" and p["tx_hash"] == tx_hash.lower():
            raise PaymentError("This payment is already recorded.")
        if p["status"] != "DUE":
            raise PaymentError(f"This payment is closed ({p['status']}): {p['reason'] or 'already settled'}.")
        if now_ms > p["due_by_ms"]:
            raise PaymentError("The payment window has closed, so the lot stays with the seller.")
        if not TX_HASH.match(tx_hash):
            raise PaymentError("That isn't a transaction hash.")
        if not p["payer"] or payer.lower() != p["payer"]:
            raise PaymentError("The payment must come from the wallet linked to the winning paddle.")
        if payee.lower() != p["payee"]:
            raise PaymentError("The payment must go to the seller's wallet.")
        if amount_wei < int(p["amount_wei"]):
            raise PaymentError("The payment is less than the amount due.")
        if self.store.payment_by_tx(tx_hash.lower()) is not None:
            raise PaymentError("That transaction already paid for another lot.")
        self.store.update_payment(auction_id, status="PAID", tx_hash=tx_hash.lower(), settled_at=now_ms, reason=None)
        return self.settlement_record(auction_id)

    def expire_due(self, now_ms: int) -> list[tuple[str, str, dict[str, Any]]]:
        """Closes every DUE payment whose window has ended. Returns their Arkiv records."""
        records = []
        for p in self.store.payments(status="DUE"):
            if now_ms > p["due_by_ms"]:
                reason = "No payment in time" if p["payer"] else f"Paddle {p['winner_alias']} never linked a wallet"
                self.store.update_payment(p["auction_id"], status="UNPAID", reason=reason, settled_at=now_ms)
                records.append(self.settlement_record(p["auction_id"]))
        return records

    def final_records(self) -> list[tuple[str, str, dict[str, Any]]]:
        """Arkiv records for every settled payment. Re-queued on start (duplicates are ignored)."""
        return [self.settlement_record(p["auction_id"]) for p in self.store.payments() if p["status"] != "DUE"]

    def settlement_record(self, auction_id: str) -> tuple[str, str, dict[str, Any]]:
        p = self.store.payment(auction_id)
        assert p is not None
        return (
            "AuctionSettlement",
            f"settlement:{auction_id}:{p['epoch']}",
            {
                "auctionId": auction_id,
                "epoch": p["epoch"],
                "status": p["status"],
                "winnerAlias": p["winner_alias"],
                "payer": p["payer"] or "",
                "payee": p["payee"] or "",
                "amountWei": p["amount_wei"],
                "chainId": SEPOLIA_CHAIN_ID,
                "txHash": p["tx_hash"] or "",
                "settledAtMs": p["settled_at"] or 0,
                "reason": p["reason"] or "",
            },
        )

    def view(self, auction_id: str) -> dict[str, Any] | None:
        p = self.store.payment(auction_id)
        return _public(p) if p else None

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        return [_public(p) for p in self.store.payments(limit=limit)]


def _public(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "auctionId": p["auction_id"],
        "epoch": p["epoch"],
        "winnerAlias": p["winner_alias"],
        "hammerPriceMinor": p["hammer_price_minor"],
        "payer": p["payer"],
        "payee": p["payee"],
        "amountWei": p["amount_wei"],
        "chainId": SEPOLIA_CHAIN_ID,
        "memo": memo_for(p["auction_id"]),
        "status": p["status"],
        "reason": p["reason"],
        "txHash": p["tx_hash"],
        "dueByMs": p["due_by_ms"],
        "createdAtMs": p["created_at"],
        "settledAtMs": p["settled_at"],
    }
