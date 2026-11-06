import hashlib
import struct
import unittest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from bid3_protocol import decode_intent, N

class Protocol(unittest.TestCase):
    def setUp(self):
        # Synthetic test identity, unrelated to either enrolled physical tag.
        self.key=ec.derive_private_key(42,ec.SECP256K1())
        self.pub=self.key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        self.device=bytes.fromhex('010203040506')
        self.body=bytearray(132);self.body[:8]=b'B3F1\x01\x12\x01\x00'
        self.body[8:14]=self.device;self.body[14:22]=b'boot0001';self.body[22:38]=b'session-00000001'
        self.body[38:70]=hashlib.sha256(b'lot-1').digest();self.body[70:102]=hashlib.sha256(b'rules').digest()
        struct.pack_into('<IIIQII',self.body,102,1,7,9,11576,3,12345)
        self.raw=self.sign(self.body)
    def sign(self,body,domain=b'Bid3.Intent.v1'):
        digest=hashlib.sha256(domain+body).digest()
        r,s=utils.decode_dss_signature(self.key.sign(digest,ec.ECDSA(utils.Prehashed(hashes.SHA256()))))
        s=min(s,N-s)
        return bytes(body)+r.to_bytes(32,'big')+s.to_bytes(32,'big')
    def test_roundtrip(self):
        p=decode_intent(self.raw,self.pub,self.device)
        self.assertEqual((p['kind'],p['seq'],p['price_minor'],p['quote_version']),('BID',9,11576,7))
    def test_all_body_mutations_rejected(self):
        for i in range(132):
            with self.subTest(byte=i):
                changed=bytearray(self.raw);changed[i]^=1
                with self.assertRaises((ValueError,InvalidSignature)):
                    decode_intent(changed,self.pub,self.device)
    def test_all_signature_mutations_rejected(self):
        for i in range(132,196):
            with self.subTest(byte=i):
                changed=bytearray(self.raw);changed[i]^=1
                with self.assertRaises((ValueError,InvalidSignature)):
                    decode_intent(changed,self.pub,self.device)
    def test_wrong_domain(self):
        with self.assertRaises(InvalidSignature):decode_intent(self.sign(self.body,b'BagTrail.ButtonProof.v1'),self.pub,self.device)
    def test_high_s(self):
        high=self.raw[:164]+(N-int.from_bytes(self.raw[164:],'big')).to_bytes(32,'big')
        with self.assertRaises(ValueError):decode_intent(high,self.pub,self.device)
    def test_wrong_enrollment(self):
        with self.assertRaises(ValueError):decode_intent(self.raw,self.pub,b'xxxxxx')
    def test_malformed_size(self):
        for n in (0,131,195,197):
            with self.assertRaises(ValueError):decode_intent(self.raw[:n]+b'x'*max(0,n-196),self.pub,self.device)

if __name__=='__main__':unittest.main()
