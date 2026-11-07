"""SQLite persistence: auction snapshots for restart recovery, an append-only
journal of every input (accepted and refused), and the outbox the Arkiv worker drains.

One engine process owns the database. WAL mode keeps reads cheap while it writes.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS auctions (
  auction_id   TEXT PRIMARY KEY,
  state_json   TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id   TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  state_version INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at_ms        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_by_auction ON journal(auction_id, id);
CREATE TABLE IF NOT EXISTS outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  logical_id   TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  published_at INTEGER,
  entity_key   TEXT,
  tx_hash      TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  superseded   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(published_at, superseded, id);
-- Paddle wallets and Sepolia payments (payments.py). Separate from the auction state on purpose.
CREATE TABLE IF NOT EXISTS bindings (
  alias        TEXT PRIMARY KEY,
  wallet       TEXT NOT NULL UNIQUE,
  bound_at_ms  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payees (
  auction_id   TEXT PRIMARY KEY,
  seller       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  auction_id   TEXT PRIMARY KEY,
  epoch        INTEGER NOT NULL,
  winner_alias TEXT NOT NULL,
  hammer_price_minor INTEGER NOT NULL,
  payer        TEXT,
  payee        TEXT,
  amount_wei   TEXT NOT NULL,
  status       TEXT NOT NULL,
  reason       TEXT,
  tx_hash      TEXT UNIQUE,
  due_by_ms    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(SCHEMA)

    # ------------------------------------------------------------ auctions

    def save_auction(self, auction_id: str, dump: dict[str, Any], now_ms: int) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO auctions(auction_id, state_json, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(auction_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at",
                (auction_id, json.dumps(dump), now_ms),
            )

    def load_auctions(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT state_json FROM auctions ORDER BY updated_at").fetchall()
        return [json.loads(r["state_json"]) for r in rows]

    # ------------------------------------------------------------ journal + outbox

    def commit(
        self,
        auction_id: str,
        epoch: int,
        state_version: int,
        dump: dict[str, Any],
        journal: list[tuple[str, dict[str, Any]]],
        outbox: list[tuple[str, str, dict[str, Any]]],
        now_ms: int,
    ) -> None:
        """Persist one transition atomically: new state, its journal lines and outbox records."""
        with self._lock:
            cur = self._db.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute(
                    "INSERT INTO auctions(auction_id, state_json, updated_at) VALUES(?,?,?) "
                    "ON CONFLICT(auction_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at",
                    (auction_id, json.dumps(dump), now_ms),
                )
                for kind, payload in journal:
                    cur.execute(
                        "INSERT INTO journal(auction_id, epoch, state_version, kind, payload_json, at_ms) VALUES(?,?,?,?,?,?)",
                        (auction_id, epoch, state_version, kind, json.dumps(payload), now_ms),
                    )
                for kind, logical_id, payload in outbox:
                    if kind == "AuctionSnapshot":
                        # Only the newest snapshot matters; older unpublished ones are dropped.
                        cur.execute(
                            "UPDATE outbox SET superseded=1 WHERE auction_id=? AND kind='AuctionSnapshot' AND published_at IS NULL",
                            (auction_id,),
                        )
                    cur.execute(
                        "INSERT OR IGNORE INTO outbox(auction_id, kind, logical_id, payload_json, created_at) VALUES(?,?,?,?,?)",
                        (auction_id, kind, logical_id, json.dumps(payload), now_ms),
                    )
                cur.execute("COMMIT")
            except Exception:
                cur.execute("ROLLBACK")
                raise

    def journal(self, auction_id: str, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, epoch, state_version, kind, payload_json, at_ms FROM journal WHERE auction_id=? ORDER BY id DESC LIMIT ?",
                (auction_id, limit),
            ).fetchall()
        return [
            {"id": r["id"], "epoch": r["epoch"], "stateVersion": r["state_version"], "kind": r["kind"], "payload": json.loads(r["payload_json"]), "atMs": r["at_ms"]}
            for r in rows
        ]

    def pending_outbox(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, auction_id, kind, logical_id, payload_json, attempts, created_at FROM outbox "
                "WHERE published_at IS NULL AND superseded=0 ORDER BY id LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "auctionId": r["auction_id"],
                "kind": r["kind"],
                "logicalId": r["logical_id"],
                "payload": json.loads(r["payload_json"]),
                "attempts": r["attempts"],
                "createdAt": r["created_at"],
            }
            for r in rows
        ]

    def pending_count(self, auction_id: str) -> int:
        with self._lock:
            row = self._db.execute(
                "SELECT COUNT(*) AS n FROM outbox WHERE auction_id=? AND published_at IS NULL AND superseded=0", (auction_id,)
            ).fetchone()
        return int(row["n"])

    def mark_published(self, outbox_id: int, entity_key: str, tx_hash: str | None, now_ms: int) -> dict[str, Any] | None:
        with self._lock:
            self._db.execute(
                "UPDATE outbox SET published_at=?, entity_key=?, tx_hash=?, attempts=attempts+1, last_error=NULL WHERE id=?",
                (now_ms, entity_key, tx_hash, outbox_id),
            )
            row = self._db.execute("SELECT auction_id, kind, payload_json FROM outbox WHERE id=?", (outbox_id,)).fetchone()
        if row is None:
            return None
        return {"auctionId": row["auction_id"], "kind": row["kind"], "payload": json.loads(row["payload_json"])}

    def mark_failed(self, outbox_id: int, error: str) -> None:
        with self._lock:
            self._db.execute("UPDATE outbox SET attempts=attempts+1, last_error=? WHERE id=?", (error[:500], outbox_id))

    def published_entities(self, auction_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT kind, logical_id, entity_key, tx_hash, published_at FROM outbox WHERE auction_id=? AND published_at IS NOT NULL ORDER BY id",
                (auction_id,),
            ).fetchall()
        return [dict(r) for r in rows]


    # ------------------------------------------------------------ payments (see payments.py)

    def queue_outbox(self, auction_id: str, kind: str, logical_id: str, payload: dict[str, Any], now_ms: int) -> None:
        """Adds one Arkiv record outside an auction transition. A record with the same logical id is ignored."""
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO outbox(auction_id, kind, logical_id, payload_json, created_at) VALUES(?,?,?,?,?)",
                (auction_id, kind, logical_id, json.dumps(payload), now_ms),
            )

    def get_setting(self, key: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return None if row is None else str(row["value"])

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def bindings(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT alias, wallet, bound_at_ms FROM bindings ORDER BY alias").fetchall()
        return [dict(r) for r in rows]

    def set_binding(self, alias: str, wallet: str, now_ms: int) -> None:
        """Links the wallet to this paddle only: any other paddle it was linked to loses it."""
        with self._lock:
            cur = self._db.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("DELETE FROM bindings WHERE wallet=? AND alias<>?", (wallet, alias))
                cur.execute(
                    "INSERT INTO bindings(alias, wallet, bound_at_ms) VALUES(?,?,?) "
                    "ON CONFLICT(alias) DO UPDATE SET wallet=excluded.wallet, bound_at_ms=excluded.bound_at_ms",
                    (alias, wallet, now_ms),
                )
                cur.execute("COMMIT")
            except Exception:
                cur.execute("ROLLBACK")
                raise

    def clear_binding(self, alias: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM bindings WHERE alias=?", (alias,))

    def set_payee(self, auction_id: str, seller: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO payees(auction_id, seller) VALUES(?,?) ON CONFLICT(auction_id) DO UPDATE SET seller=excluded.seller",
                (auction_id, seller),
            )

    def payee(self, auction_id: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT seller FROM payees WHERE auction_id=?", (auction_id,)).fetchone()
        return None if row is None else str(row["seller"])

    def insert_payment(self, row: dict[str, Any]) -> None:
        columns = ", ".join(row)
        with self._lock:
            self._db.execute(f"INSERT OR IGNORE INTO payments({columns}) VALUES({', '.join('?' for _ in row)})", tuple(row.values()))

    _PAYMENT_FIELDS = frozenset({"payer", "status", "reason", "tx_hash", "settled_at"})

    def update_payment(self, auction_id: str, **fields: Any) -> None:
        assert fields and set(fields) <= self._PAYMENT_FIELDS
        with self._lock:
            self._db.execute(
                f"UPDATE payments SET {', '.join(f'{k}=?' for k in fields)} WHERE auction_id=?",
                (*fields.values(), auction_id),
            )

    def payment(self, auction_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM payments WHERE auction_id=?", (auction_id,)).fetchone()
        return None if row is None else dict(row)

    def payment_by_tx(self, tx_hash: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM payments WHERE tx_hash=?", (tx_hash,)).fetchone()
        return None if row is None else dict(row)

    def payments(self, status: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        with self._lock:
            if status is None:
                rows = self._db.execute("SELECT * FROM payments ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            else:
                rows = self._db.execute("SELECT * FROM payments WHERE status=? ORDER BY created_at DESC LIMIT ?", (status, limit)).fetchall()
        return [dict(r) for r in rows]

    def outbox_by_logical_id(self, logical_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute(
                "SELECT id, kind, published_at, entity_key, tx_hash, attempts, last_error FROM outbox WHERE logical_id=?", (logical_id,)
            ).fetchone()
        return None if row is None else dict(row)
