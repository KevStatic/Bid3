"""Deployment safety: no public engine without tokens, and no bridge token in the logs."""

import logging

import pytest
from fastapi.testclient import TestClient

from bid3_engine.__main__ import RedactTokens
from bid3_engine.api import create_app
from bid3_engine.config import Settings


def settings(tmp_path, **overrides):
    fields = dict(
        database_path=str(tmp_path / "bid3.sqlite"),
        bridge_token="bridge-secret",
        admin_token="admin-secret",
        worker_token="worker-secret",
        seed_demo=False,
        require_tokens=True,
    )
    fields.update(overrides)
    return Settings(**fields)


def test_refuses_to_start_with_an_empty_token_when_required(tmp_path):
    with pytest.raises(RuntimeError, match="ADMIN_TOKEN"):
        with TestClient(create_app(settings(tmp_path, admin_token=""))):
            pass


def test_starts_when_every_token_is_set(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.get("/health").json()["ok"] is True


def test_empty_tokens_still_allowed_locally(tmp_path):
    local = settings(tmp_path, bridge_token="", admin_token="", worker_token="", require_tokens=False)
    with TestClient(create_app(local)) as client:
        assert client.get("/health").json()["ok"] is True


@pytest.mark.parametrize("on_railway", [True, False])
def test_require_tokens_defaults_on_only_on_railway(monkeypatch, on_railway):
    for name in ("REQUIRE_TOKENS", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT"):
        monkeypatch.delenv(name, raising=False)
    if on_railway:
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "abc")
    assert Settings().require_tokens is on_railway


def test_bridge_token_is_redacted_from_uvicorn_lines():
    # The exact shape uvicorn logs when a WebSocket is accepted.
    record = logging.LogRecord("uvicorn.error", logging.INFO, __file__, 0, '%s - "WebSocket %s" [accepted]',
                               ("1.2.3.4:5555", "/bridge?token=s3cr3t-Tok_en"), None)
    RedactTokens().filter(record)
    line = record.getMessage()
    assert "s3cr3t" not in line and "/bridge?token=***" in line
