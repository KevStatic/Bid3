import unittest,json,hashlib,struct,re
from pathlib import Path
from cryptography.hazmat.primitives import serialization,hashes
from cryptography.hazmat.primitives.asymmetric import ec,utils
from scan_protocol import verify_scan
from tag_protocol import ORDER
ROOT=Path(__file__).resolve().parents[1]
class ScanTests(unittest.TestCase):
 def setUp(self):
  self.f=json.loads((ROOT/'tools/known_answer.json').read_text());self.request=bytes.fromhex(self.f['request'])
  self.key=ec.generate_private_key(ec.SECP256K1());self.pub=self.key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
  self.body=bytearray(264);self.body[:8]=b'BTGW'+bytes([1,1,1,0]);self.body[8:24]=self.request[4:20];self.body[24:56]=self.request[20:52];self.body[56:64]=b'gwboot01'
  struct.pack_into('<IIh',self.body,64,1,10000,-57);self.body[74:264]=bytes.fromhex(self.f['proof']);self.scan=self.sign(self.body)
 def sign(self,body):
  h=hashlib.sha256(b'BagTrail.GatewayScan.v1'+body).digest();r,s=utils.decode_dss_signature(self.key.sign(h,ec.ECDSA(utils.Prehashed(hashes.SHA256()))));s=min(s,ORDER-s)
  return bytes(body)+r.to_bytes(32,'big')+s.to_bytes(32,'big')
 def verify(self,scan=None,**changes):
  args=dict(gateway_public_key=self.pub,expected_gateway_uuid=self.request[4:20],expected_checkpoint_hash=self.request[20:52],tag_public_key=bytes.fromhex(self.f['public_key']),tag_number=1,tag_device_id=bytes.fromhex(self.f['device']),expected_challenge=self.request,used_nonces=set());args.update(changes)
  return verify_scan(self.scan if scan is None else scan,**args)
 def test_both_signatures_verified(self):
  v=self.verify();self.assertTrue(v['gateway_verified']);self.assertTrue(v['tag']['verified']);self.assertEqual(v['rssi_dbm'],-57)
 def test_every_gateway_body_byte_authenticated(self):
  for i in range(264):
   with self.subTest(offset=i):
    p=bytearray(self.scan);p[i]^=1
    with self.assertRaises(Exception):self.verify(p)
 def test_tag_signature_still_required_with_valid_gateway_signature(self):
  body=bytearray(self.body);body[200]^=1
  with self.assertRaises(Exception):self.verify(self.sign(body))
 def test_replay_consumes_nonce_once(self):
  used=set();self.verify(used_nonces=used)
  with self.assertRaises(ValueError):self.verify(used_nonces=used)
 def test_bad_gateway_does_not_burn_tag_nonce(self):
  used=set();p=bytearray(self.scan);p[-1]^=1
  with self.assertRaises(Exception):self.verify(p,used_nonces=used)
  self.assertFalse(used)
 def test_actual_enrollment_points_and_fingerprints(self):
  config=(ROOT/'Gateway/Config.h').read_text()
  keys=re.findall(r'"(04[0-9a-f]{128})"',config);fingers=re.findall(r'"([0-9a-f]{64})"',config)
  self.assertEqual(len(keys),2);self.assertEqual(len(fingers),2)
  for key,finger in zip(keys,fingers):
   pub=bytes.fromhex(key);ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(),pub)
   self.assertEqual(hashlib.sha256(pub).hexdigest(),finger)
if __name__=='__main__':unittest.main(verbosity=2)
