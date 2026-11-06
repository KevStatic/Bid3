"""Offline verifier for the gateway's serial SCAN_JSON output.

The gateway key must be enrolled independently over USB, not accepted from
the same record being verified. The caller supplies an unexpired outstanding
tag challenge and a durable nonce-consumption mechanism in a real backend.
"""
import hashlib
import struct
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec,utils
from tag_protocol import ORDER,verify_proof

def verify_scan(scan, *, gateway_public_key, expected_gateway_uuid,
                expected_checkpoint_hash, tag_public_key, tag_number,
                tag_device_id, expected_challenge, used_nonces):
    scan=bytes(scan)
    if len(scan)!=328 or scan[:4]!=b'BTGW' or scan[4]!=1 or scan[7]!=0:
        raise ValueError('Invalid gateway scan header/length.')
    if scan[5]!=tag_number or scan[6]&~7 or scan[8:24]!=expected_gateway_uuid or scan[24:56]!=expected_checkpoint_hash:
        raise ValueError('Gateway/checkpoint/tag mismatch.')
    if scan[5]!=scan[79] or scan[6]!=scan[80] or not struct.unpack_from('<I',scan,64)[0]:
        raise ValueError('Envelope does not match embedded tag proof.')
    rssi=struct.unpack_from('<h',scan,72)[0]
    if not -127<=rssi<0:
        raise ValueError('Invalid observed RSSI.')
    r=int.from_bytes(scan[264:296],'big');s=int.from_bytes(scan[296:328],'big')
    if not 0<r<ORDER or not 0<s<=ORDER//2:
        raise ValueError('Invalid canonical gateway signature.')
    pub=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),gateway_public_key)
    digest=hashlib.sha256(b'BagTrail.GatewayScan.v1'+scan[:264]).digest()
    pub.verify(utils.encode_dss_signature(r,s),digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
    tag=verify_proof(scan[74:264],enrolled_public_key=tag_public_key,
        enrolled_tag=tag_number,enrolled_device_id=tag_device_id,
        expected_challenge=expected_challenge,used_nonces=used_nonces)
    return dict(tag=tag,gateway_verified=True,rssi_dbm=rssi,
                gateway_sequence=struct.unpack_from('<I',scan,64)[0],
                gateway_uptime_ms=struct.unpack_from('<I',scan,68)[0],
                digest_sha256=digest.hex())
