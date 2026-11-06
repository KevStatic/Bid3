import hashlib
import re
import struct
import unittest
from pathlib import Path
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import ec,utils
from button_protocol import verify_button_scan,TAG_DOMAIN,SCAN_DOMAIN
from tag_protocol import ORDER

class ButtonProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tag_key=ec.generate_private_key(ec.SECP256K1())
        self.gateway_key=ec.generate_private_key(ec.SECP256K1())
        encode=lambda key:key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        self.tag_pub=encode(self.tag_key);self.gateway_pub=encode(self.gateway_key)
        self.gateway=bytes(range(16));self.checkpoint=hashlib.sha256(b'demo-checkpoint').digest()
        self.device=bytes(range(6));self.nonce=bytes(range(1,33))
        self.request=b'BTB1'+self.gateway+self.checkpoint+self.nonce
        self.proof_body=bytearray(135);self.proof_body[:8]=b'BTP1'+bytes([1,1,0,0])
        self.proof_body[8:14]=self.device;self.proof_body[14:22]=b'tagboot1'
        struct.pack_into('<IIH7h',self.proof_body,22,1,1000,65535,*([-32768]*7))
        self.proof_body[46:126]=self.request[4:84]
        struct.pack_into('<IIB',self.proof_body,126,3,900,0)
        self.body=bytearray(273);self.body[:8]=b'BGB1'+bytes([1,1,0,0])
        self.body[8:24]=self.gateway;self.body[24:56]=self.checkpoint;self.body[56:64]=b'gateway1'
        struct.pack_into('<IIh',self.body,64,1,1200,-55)
        self.body[74:273]=self.tag_sign(self.proof_body)
        self.scan=self.gateway_sign(self.body)
    def sign(self,key,domain,body):
        digest=hashlib.sha256(domain+body).digest()
        r,s=utils.decode_dss_signature(key.sign(digest,ec.ECDSA(utils.Prehashed(hashes.SHA256()))))
        s=min(s,ORDER-s)
        return bytes(body)+r.to_bytes(32,'big')+s.to_bytes(32,'big')
    def tag_sign(self,body,domain=TAG_DOMAIN):return self.sign(self.tag_key,domain,body)
    def gateway_sign(self,body):return self.sign(self.gateway_key,SCAN_DOMAIN,body)
    def verify(self,scan=None,**changes):
        args=dict(gateway_public_key=self.gateway_pub,expected_gateway_uuid=self.gateway,
                  expected_checkpoint_hash=self.checkpoint,tag_public_key=self.tag_pub,tag_number=1,
                  tag_device_id=self.device,expected_challenge=self.request,challenge_age_ms=100,used_nonces=set())
        args.update(changes)
        return verify_button_scan(self.scan if scan is None else scan,**args)
    def test_short_tap_remains_in_signed_count_after_release(self):
        result=self.verify();self.assertEqual(result['tag']['press_count'],3)
        self.assertFalse(result['tag']['button_pressed']);self.assertTrue(result['gateway_verified'])
    def test_every_gateway_body_byte_authenticated(self):
        for i in range(273):
            with self.subTest(offset=i):
                changed=bytearray(self.scan);changed[i]^=1
                with self.assertRaises(Exception):self.verify(changed)
    def test_every_button_field_requires_tag_signature_even_if_gateway_resigns(self):
        for i in range(126,135):
            with self.subTest(offset=i):
                changed=bytearray(self.body);changed[74+i]^=1
                with self.assertRaises(Exception):self.verify(self.gateway_sign(changed))
    def test_wrong_tag_domain_rejected(self):
        changed=bytearray(self.body);changed[74:273]=self.tag_sign(self.proof_body,b'BagTrail.TagProof.v1')
        with self.assertRaises(Exception):self.verify(self.gateway_sign(changed))
    def test_replay_and_expiry(self):
        used=set();self.verify(used_nonces=used)
        with self.assertRaises(ValueError):self.verify(used_nonces=used)
        with self.assertRaises(ValueError):self.verify(challenge_age_ms=5001)
        with self.assertRaises(ValueError):self.verify(expected_challenge=b'BTQ1'+self.request[4:])
    def test_bad_outer_signature_does_not_consume_nonce(self):
        used=set();changed=bytearray(self.scan);changed[-1]^=1
        with self.assertRaises(Exception):self.verify(changed,used_nonces=used)
        self.assertFalse(used)
    def test_bad_inner_signature_does_not_consume_nonce(self):
        used=set();changed=bytearray(self.body);changed[74+140]^=1
        with self.assertRaises(Exception):self.verify(self.gateway_sign(changed),used_nonces=used)
        self.assertFalse(used)
    def test_high_s_rejected(self):
        changed=bytearray(self.scan);s=int.from_bytes(changed[-32:],'big')
        changed[-32:]=(ORDER-s).to_bytes(32,'big')
        with self.assertRaises(ValueError):self.verify(changed)
    def test_actual_enrollment_unchanged(self):
        root=Path(__file__).resolve().parents[1]
        config=(root/'Gateway/Config.h').read_text()
        keys=re.findall(r'"(04[0-9a-f]{128})"',config)
        self.assertEqual([hashlib.sha256(bytes.fromhex(k)).hexdigest() for k in keys],[
            '62e03e55f49d7b0266a1b4a37f3a5d6beaef0d103e5da9e1b1123a077229732d',
            '29c8d86053cb68f53b60cda41370f223348948158317358c26d263a09447e360'])
        self.assertEqual(re.findall(r'"([0-9a-f]{12})"',config),['146393bef0bc','146393bef594'])

if __name__=='__main__':unittest.main(verbosity=2)
