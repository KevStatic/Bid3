"""BagTrail v1 reference decoder/verifier. Requires cryptography (host only)."""
import hashlib
import struct
import uuid
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

DOMAIN = b'BagTrail.TagProof.v1'
ORDER = int('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',16)
SERVICE = 'b7610001-7e1d-4e8b-9a73-8f1b0c4d9000'
INFO = 'b7610002-7e1d-4e8b-9a73-8f1b0c4d9000'
TELEMETRY = 'b7610003-7e1d-4e8b-9a73-8f1b0c4d9000'
CHALLENGE = 'b7610004-7e1d-4e8b-9a73-8f1b0c4d9000'
RESPONSE = 'b7610005-7e1d-4e8b-9a73-8f1b0c4d9000'

def build_challenge(gateway_id, checkpoint_id, nonce):
    gateway = uuid.UUID(str(gateway_id)).bytes
    checkpoint = hashlib.sha256(checkpoint_id.encode('utf-8')).digest()
    nonce = bytes(nonce)
    if len(nonce)!=32 or nonce==bytes(32):
        raise ValueError('Nonce must contain 32 fresh random bytes, not all zero.')
    return b'BTQ1'+gateway+checkpoint+nonce

def decode_info(data):
    data=bytes(data)
    if len(data)!=108 or data[:4]!=b'BTI1' or data[4] not in (1,2):
        raise ValueError('Invalid info frame.')
    pub=data[11:76]
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),pub)
    if hashlib.sha256(pub).digest()!=data[76:108]:
        raise ValueError('Public-key fingerprint mismatch.')
    return {'tag':data[4], 'device_id':data[5:11].hex(),
            'public_key':pub.hex(), 'fingerprint':data[76:108].hex()}

def decode_proof(data):
    data=bytes(data)
    if len(data)!=190 or data[:4]!=b'BTAG' or data[4]!=1:
        raise ValueError('Invalid proof format or length.')
    if data[5] not in (1,2) or data[6]&~7 or data[7]!=0:
        raise ValueError('Invalid tag, flags, or reserved byte.')
    seq,uptime,age=struct.unpack_from('<IIH',data,22)
    if not seq:
        raise ValueError('Sequence must be positive.')
    values=struct.unpack_from('<7h',data,32)
    valid=bool(data[6]&1)
    if valid and (age>1000 or -32768 in values):
        raise ValueError('Invalid or stale motion marked valid.')
    if not valid and (age!=65535 or any(v!=-32768 for v in values) or data[6]&2):
        raise ValueError('Invalid motion sentinel encoding.')
    return {'tag':data[5], 'flags':data[6], 'device_id':data[8:14].hex(),
            'boot_id':data[14:22].hex(), 'sequence':seq, 'uptime_ms':uptime,
            'sample_age_ms':age, 'sensor_valid':valid, 'moving':bool(data[6]&2),
            'acceleration_mg':list(values[:3]) if valid else None,
            'gyro_tenths_deg_s':list(values[3:6]) if valid else None,
            'temperature_c':values[6]/100 if valid else None,
            'gateway_id':str(uuid.UUID(bytes=data[46:62])),
            'checkpoint_hash':data[62:94].hex(), 'nonce':data[94:126].hex()}

def verify_proof(proof, *, enrolled_public_key, enrolled_tag, enrolled_device_id,
                 expected_challenge, used_nonces):
    """Call only while expected_challenge is outstanding AND unexpired.

    used_nonces is a persistent/transactional store in a real gateway/backend.
    This reference set implementation is suitable for single-process tests.
    Never enroll the key automatically from the same untrusted BLE connection.
    """
    proof=bytes(proof); expected_challenge=bytes(expected_challenge)
    if len(expected_challenge)!=84 or expected_challenge[:4]!=b'BTQ1':
        raise ValueError('Invalid expected challenge.')
    nonce=expected_challenge[52:84]
    if nonce==bytes(32) or nonce.hex() in used_nonces:
        raise ValueError('Invalid or already-consumed nonce.')
    result=decode_proof(proof)
    device=bytes.fromhex(enrolled_device_id) if isinstance(enrolled_device_id,str) else bytes(enrolled_device_id)
    if result['tag']!=enrolled_tag or proof[8:14]!=device:
        raise ValueError('Enrolled tag/device mismatch.')
    if proof[46:126]!=expected_challenge[4:84]:
        raise ValueError('Gateway, checkpoint or nonce mismatch.')
    pub=bytes.fromhex(enrolled_public_key) if isinstance(enrolled_public_key,str) else bytes(enrolled_public_key)
    public=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),pub)
    r=int.from_bytes(proof[126:158],'big');s=int.from_bytes(proof[158:190],'big')
    if not 0<r<ORDER or not 0<s<=ORDER//2:
        raise ValueError('Invalid or non-canonical signature.')
    digest=hashlib.sha256(DOMAIN+proof[:126]).digest()
    public.verify(utils.encode_dss_signature(r,s),digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
    used_nonces.add(nonce.hex())  # consume only after every validation succeeds
    result['verified']=True
    result['digest_sha256']=digest.hex()
    return result
