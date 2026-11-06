import hashlib

import pytest
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import sigencode_string

from bid3_engine.intents import IntentError, parse_intent, verify_signature


def sign(key: SigningKey, raw: dict) -> dict:
    intent = parse_intent(raw)
    sig = key.sign_digest(hashlib.sha256(intent.message()).digest(), sigencode=sigencode_string)
    return {**raw, "sig": sig.hex()}


def test_canonical_message():
    intent = parse_intent({"kind": "bid", "tag": "TAG1", "session": "b7", "seq": 17, "stateVersion": 42})
    assert intent.message() == b"Bid3.Intent.v1|TAG1|b7|17|BID|42"
    assert parse_intent({"kind": "JOIN", "tag": "TAG1"}).message() == b"Bid3.Intent.v1|TAG1|||JOIN|"


def test_valid_signature_verifies_and_tampering_fails():
    key = SigningKey.generate(curve=SECP256k1)
    public = key.get_verifying_key().to_string("compressed").hex()
    signed = sign(key, {"kind": "BID", "tag": "TAG1", "session": "s", "seq": 3, "stateVersion": 9})
    assert verify_signature(parse_intent(signed), public)
    assert not verify_signature(parse_intent({**signed, "seq": 4}), public)  # replayed with a new seq
    other = SigningKey.generate(curve=SECP256k1).get_verifying_key().to_string("compressed").hex()
    assert not verify_signature(parse_intent(signed), other)


def test_bad_intents_raise():
    with pytest.raises(IntentError):
        parse_intent({"kind": "BID"})
    with pytest.raises(IntentError):
        parse_intent({"kind": "LINK", "tag": "TAG1"})
    with pytest.raises(IntentError):
        parse_intent({"kind": "BID", "tag": "TAG1", "seq": "x"})
