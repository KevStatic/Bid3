"""Host reference verifier for signed D2 button snapshots, not an auction engine.

Caller must independently enroll keys, authorize gateway/checkpoint and supply an
outstanding unexpired expected challenge. Durable atomic replay state is required
for a backend; the supplied Python set is for single-process reference use.
"""
import hashlib
import struct
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils
from tag_protocol import ORDER, decode_proof

TAG_DOMAIN=b'BagTrail.ButtonProof.v1'
SCAN_DOMAIN=b'BagTrail.GatewayButtonScan.v1'

def verify_signature(public_key, domain, body, signature):
    if len(signature)!=64:
        raise ValueError('Wrong signature length.')
    r=int.from_bytes(signature[:32],'big');s=int.from_bytes(signature[32:],'big')
    if not 0<r<ORDER or not 0<s<=ORDER//2:
        raise ValueError('Noncanonical signature.')
    key=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),bytes(public_key))
    digest=hashlib.sha256(domain+body).digest()
    key.verify(utils.encode_dss_signature(r,s),digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
    return digest.hex()

def verify_button_scan(scan, *, gateway_public_key, expected_gateway_uuid,
                       expected_checkpoint_hash, tag_public_key, tag_number,
                       tag_device_id, expected_challenge, challenge_age_ms,
                       used_nonces):
    scan=bytes(scan);request=bytes(expected_challenge)
    if len(request)!=84 or request[:4]!=b'BTB1' or not 0<=challenge_age_ms<=5000:
        raise ValueError('Missing or expired button challenge.')
    nonce=request[52:84]
    replay_key=(bytes(expected_gateway_uuid).hex(),bytes(tag_device_id).hex(),nonce.hex())
    if nonce==bytes(32) or replay_key in used_nonces:
        raise ValueError('Zero or already-consumed nonce.')
    if len(scan)!=337 or scan[:4]!=b'BGB1' or scan[4]!=1 or scan[7]!=0:
        raise ValueError('Invalid gateway button envelope.')
    if (scan[5]!=tag_number or scan[6]&~7 or scan[8:24]!=bytes(expected_gateway_uuid)
        or scan[24:56]!=bytes(expected_checkpoint_hash) or not struct.unpack_from('<I',scan,64)[0]):
        raise ValueError('Gateway context mismatch.')
    rssi=struct.unpack_from('<h',scan,72)[0]
    if not -127<=rssi<0:
        raise ValueError('Invalid RSSI.')
    digest=verify_signature(gateway_public_key,SCAN_DOMAIN,scan[:273],scan[273:337])
    proof=scan[74:273]
    if proof[:4]!=b'BTP1' or proof[134]>1 or proof[5:7]!=scan[5:7]:
        raise ValueError('Invalid button proof or envelope consistency.')
    # Reuse the legacy field decoder only, never its different signature domain.
    legacy=b'BTAG'+proof[4:126]+bytes(64)
    data=decode_proof(legacy)
    if data['tag']!=tag_number or proof[8:14]!=bytes(tag_device_id) or proof[46:126]!=request[4:84]:
        raise ValueError('Tag identity or challenge mismatch.')
    count,last_press=struct.unpack_from('<II',proof,126)
    if not count and last_press:
        raise ValueError('Impossible empty press history.')
    tag_digest=verify_signature(tag_public_key,TAG_DOMAIN,proof[:135],proof[135:199])
    used_nonces.add(replay_key)  # only after both signatures/context validations
    data.update(press_count=count,last_press_tag_uptime_ms=last_press,button_pressed=bool(proof[134]),
                verified=True,digest_sha256=tag_digest)
    return dict(tag=data,gateway_verified=True,rssi_dbm=rssi,
                gateway_sequence=struct.unpack_from('<I',scan,64)[0],
                gateway_uptime_ms=struct.unpack_from('<I',scan,68)[0],digest_sha256=digest)
