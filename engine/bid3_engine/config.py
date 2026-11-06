"""Engine settings, all from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


def _on_railway() -> bool:
    return any(os.environ.get(name) for name in ("RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT"))


@dataclass(frozen=True)
class Settings:
    database_path: str = field(default_factory=lambda: os.environ.get("DATABASE_PATH", "./data/bid3.sqlite"))
    # Shared secrets. Leave empty only for local development.
    bridge_token: str = field(default_factory=lambda: os.environ.get("BRIDGE_TOKEN", ""))
    admin_token: str = field(default_factory=lambda: os.environ.get("ADMIN_TOKEN", ""))
    worker_token: str = field(default_factory=lambda: os.environ.get("WORKER_TOKEN", ""))
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:3000"))
    # Resume automatically once every paddle and the bridge are back. Off = an operator calls /resync.
    auto_resume: bool = field(default_factory=lambda: _bool("AUTO_RESUME", True))
    require_signatures: bool = field(default_factory=lambda: _bool("INTENT_SIGNATURES_REQUIRED", False))
    snapshot_interval_ms: int = field(default_factory=lambda: int(os.environ.get("SNAPSHOT_INTERVAL_MS", "4000")))
    # Refuse to start with an empty token. Defaults to on when running on Railway; set REQUIRE_TOKENS=1 on other hosts.
    require_tokens: bool = field(default_factory=lambda: _bool("REQUIRE_TOKENS", _on_railway()))
    # Seed the demo auction (bid3-003, two paddles) on first start.
    seed_demo: bool = field(default_factory=lambda: _bool("SEED_DEMO", True))
    seed_tags: str = field(default_factory=lambda: os.environ.get("SEED_TAGS", "TAG1:K7,TAG2:M4"))
    seed_countdown_ms: int = field(default_factory=lambda: int(os.environ.get("SEED_COUNTDOWN_MS", "5000")))
    # Sepolia payments (payments.py): when a lot sells, the winning paddle's linked wallet pays the seller.
    # Off by default: nothing about a round changes until PAYMENTS=1.
    payments_enabled: bool = field(default_factory=lambda: _bool("PAYMENTS", False))
    # Wei per 1.00 credit of the hammer price. 0 = a 0 ETH payment, only gas. The admin page can change
    # it at any time (stored in the database, which then wins over this default).
    payment_wei_per_credit: int = field(default_factory=lambda: int(os.environ.get("PAYMENT_WEI_PER_CREDIT", "0")))
    # How long the winner has to pay before the lot stays with the seller.
    payment_window_ms: int = field(default_factory=lambda: int(os.environ.get("PAYMENT_WINDOW_MS", str(10 * 60_000))))


def load_settings() -> Settings:
    return Settings()
