"""Independent private bridge decoder. Never publish raw intent/device/session bytes.
Engine must additionally check current enrollment, issued session, quote, epoch,
nonce freshness, ingestion deadline and durable idempotency before accepting.
"""
import hashlib
import struct
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes

N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
KINDS = {16:'JOIN',17:'LEAVE',18:'BID',19:'HELLO'}

def decode_intent(raw, public_key, expected_device):
    if len(raw)!=196 or raw[:5]!=b'B3F1\x01' or raw[5] not in KINDS or raw[6] not in (1,2) or raw[7] or raw[130:132]!=b'\0\0':
        raise ValueError('malformed intent')
    if len(expected_device)!=6 or raw[8:14]!=expected_device:
        raise ValueError('wrong enrolled device')
    r,s = int.from_bytes(raw[132:164],'big'),int.from_bytes(raw[164:196],'big')
    if not (0<r<N and 0<s<=N//2):
        raise ValueError('noncanonical signature')
    key=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(), public_key)
    digest=hashlib.sha256(b'Bid3.Intent.v1'+raw[:132]).digest()
    key.verify(utils.encode_dss_signature(r,s),digest,ec.ECDSA(utils.Prehashed(hashes.SHA256())))
    price=struct.unpack_from('<Q',raw,114)[0]
    if price>(1<<53)-1:
        raise ValueError('price exceeds web integer contract')
    return dict(tag=raw[6], kind=KINDS[raw[5]],device=raw[8:14].hex(),boot=raw[14:22].hex(),
                session=raw[22:38].hex(),auction_hash=raw[38:70].hex(),rules_hash='0x'+raw[70:102].hex(),
                epoch=struct.unpack_from('<I',raw,102)[0],quote_version=struct.unpack_from('<I',raw,106)[0],
                seq=struct.unpack_from('<I',raw,110)[0],price_minor=price,
                press_count=struct.unpack_from('<I',raw,122)[0],edge_uptime_ms=struct.unpack_from('<I',raw,126)[0])
