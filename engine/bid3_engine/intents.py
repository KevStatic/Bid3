"""Paddle intents as they arrive from the gateway, and their optional signatures.

The bridge forwards each `AUCTION_EVENT_JSON=` line from the gateway as:

    {"v": 1, "kind": "BID", "tag": "TAG1", "session": "b7", "seq": 17,
     "stateVersion": 42, "sig": "<128 hex chars>"}

  kind          JOIN | LEAVE | BID | LINK
  tag           the tag's enrolled reference (matches a seat's tagRef)
  session       changes on every tag boot (optional; enables duplicate detection)
  seq           per-session counter, increments on every intent
  stateVersion  BID only: the last engine state version the tag received (optional)
  link          LINK only: "OK" or "LOST"
  sig           optional secp256k1 signature, see below

Signatures (INTENT_SIGNATURES=required):
  message = "Bid3.Intent.v1|{tag}|{session}|{seq}|{kind}|{stateVersion}"
            (empty string for a missing field)
  sig     = 64-byte r||s over sha256(message), hex, by the tag's enrolled key
LINK reports come from the gateway itself and are not signed by tags.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from ecdsa import BadSignatureError, SECP256k1, VerifyingKey
from ecdsa.util import sigdecode_string

DOMAIN = "Bid3.Intent.v1"
KINDS = ("JOIN", "LEAVE", "BID", "LINK")


class IntentError(ValueError):
    pass


@dataclass(frozen=True)
class Intent:
    kind: str
    tag: str
    session: str | None
    seq: int | None
    state_version: int | None
    link_ok: bool | None
    sig: str | None

    def message(self) -> bytes:
        parts = [
            DOMAIN,
            self.tag,
            self.session or "",
            "" if self.seq is None else str(self.seq),
            self.kind,
            "" if self.state_version is None else str(self.state_version),
        ]
        return "|".join(parts).encode("utf-8")


def parse_intent(raw: dict[str, Any]) -> Intent:
    kind = str(raw.get("kind", "")).upper()
    if kind not in KINDS:
        raise IntentError(f"unknown kind {kind!r}")
    tag = raw.get("tag")
    if not isinstance(tag, str) or not tag:
        raise IntentError("missing tag")

    def opt_int(name: str) -> int | None:
        value = raw.get(name)
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise IntentError(f"{name} must be an integer") from exc

    link = raw.get("link")
    link_ok = None
    if kind == "LINK":
        if str(link).upper() not in ("OK", "LOST"):
            raise IntentError("LINK needs link: OK or LOST")
        link_ok = str(link).upper() == "OK"

    session = raw.get("session")
    return Intent(
        kind=kind,
        tag=tag,
        session=str(session) if session is not None else None,
        seq=opt_int("seq"),
        state_version=opt_int("stateVersion"),
        link_ok=link_ok,
        sig=raw.get("sig"),
    )


def verify_signature(intent: Intent, public_key_hex: str) -> bool:
    """True if `intent.sig` is a valid secp256k1 signature by `public_key_hex` (33 or 65 byte SEC1)."""
    if not intent.sig:
        return False
    try:
        key = VerifyingKey.from_string(bytes.fromhex(public_key_hex.removeprefix("0x")), curve=SECP256k1)
        digest = hashlib.sha256(intent.message()).digest()
        return key.verify_digest(bytes.fromhex(intent.sig.removeprefix("0x")), digest, sigdecode=sigdecode_string)
    except (BadSignatureError, ValueError):
        return False
