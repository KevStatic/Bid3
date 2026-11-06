import hashlib,hmac,subprocess,unittest,os
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

ROOT=Path(__file__).resolve().parents[1]
ENGINE=Path(os.environ.get('BID3_ENGINE_PATH',str(ROOT.parent/'engine')))

class FastProtocol(unittest.TestCase):
 @unittest.skipUnless(ENGINE.exists(),'set BID3_ENGINE_PATH to the team engine directory')
 def test_canonical_matches_actual_engine(self):
  import sys
  sys.path.insert(0,str(ENGINE))
  from bid3_engine.intents import parse_intent
  output=subprocess.check_output([os.environ.get('BID3_FAST_WIRE_TEST_BIN','/private/tmp/bid3-v4-fast-wire-tests')],text=True).splitlines()
  session=bytes(range(0xa0,0xa8)).hex()+'-'+bytes(range(32)).hex()
  for kind,line in zip(('JOIN','LEAVE','BID'),output):
   event={'kind':kind,'tag':'TAG1','session':session,'seq':17}
   if kind=='BID':event['stateVersion']=42
   self.assertEqual(parse_intent(event).message().decode(),line)
 def test_kdf_matches_standard_hkdf(self):
  a=ec.derive_private_key(42,ec.SECP256K1());b=ec.derive_private_key(79,ec.SECP256K1())
  shared=a.exchange(ec.ECDH(),b.public_key());self.assertEqual(shared,b.exchange(ec.ECDH(),a.public_key()))
  nonce=bytes(range(32));info=b'Bid3.FastSession.v4'+b'boot0001'+b'gateway-uuid-001'
  self.assertEqual(len(info[-16:]),16)
  prk=hmac.new(nonce,shared,hashlib.sha256).digest();derived=hmac.new(prk,info+b'\x01',hashlib.sha256).digest()
  self.assertEqual(derived,HKDF(algorithm=hashes.SHA256(),length=32,salt=nonce,info=info).derive(shared))
  changed=HKDF(algorithm=hashes.SHA256(),length=32,salt=nonce[::-1],info=info).derive(shared)
  self.assertNotEqual(derived,changed)
 def test_gateway_and_tag_real_public_pins(self):
  import re
  text=(ROOT/'shared/FastTag.h').read_text();pub=bytes.fromhex(re.search(r'TRUSTED_GATEWAY\[\]="([0-9a-f]+)"',text).group(1))
  self.assertEqual(hashlib.sha256(pub).hexdigest(),'068abe81ebff2c1a0115ee666a0deb01a1cfb4c054000aaac7d287b76a1c41a8')
 @unittest.skipUnless(ENGINE.exists(),'set BID3_ENGINE_PATH to the team engine directory')
 def test_signed_bid_verifies_with_current_engine(self):
  import sys
  sys.path.insert(0,str(ENGINE))
  from bid3_engine.intents import parse_intent,verify_signature
  from cryptography.hazmat.primitives import serialization
  from cryptography.hazmat.primitives.asymmetric import utils
  private=ec.derive_private_key(42,ec.SECP256K1()) # synthetic fixture, not a device key
  event={'kind':'BID','tag':'TAG1','session':'a0a1a2a3a4a5a6a7-'+bytes(range(32)).hex(),'seq':17,'stateVersion':42}
  message=parse_intent(event).message();digest=hashlib.sha256(message).digest()
  rr,ss=utils.decode_dss_signature(private.sign(digest,ec.ECDSA(utils.Prehashed(hashes.SHA256()))))
  order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;ss=min(ss,order-ss)
  event['sig']=(rr.to_bytes(32,'big')+ss.to_bytes(32,'big')).hex()
  public=private.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint).hex()
  self.assertTrue(verify_signature(parse_intent(event),public));event['stateVersion']=43
  self.assertFalse(verify_signature(parse_intent(event),public))
 def test_legacy_crypto_files_unchanged(self):
  import json
  baseline=json.loads((ROOT/'legacy_docs/BASELINE_SHA256.json').read_text())
  for name,digest in baseline.items():
   self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),digest,name)

if __name__=='__main__':unittest.main()
