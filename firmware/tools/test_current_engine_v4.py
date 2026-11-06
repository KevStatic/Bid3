import unittest,sys,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ENGINE=Path(os.environ.get('BID3_ENGINE_PATH',str(ROOT.parent/'engine')))
if ENGINE.exists():sys.path.insert(0,str(ENGINE))
@unittest.skipUnless(ENGINE.exists(),'requires the team engine beside this package')
class ActualEngineV4(unittest.TestCase):
 def make(self):
  from bid3_engine.auction import Auction,Rules
  a=Auction('v4-test','lot',Rules(10000,500,10000,100000,600000),[('TAG1','K7'),('TAG2','M4')]);a.health['bridge']='ok';a.open(0)
  a.join(0,'TAG1',session='s1',seq=1);a.join(0,'TAG2',session='s2',seq=1);return a
 def test_same_quote_first_valid_wins_second_is_stale(self):
  a=self.make();v=a.state_version
  self.assertEqual(a.bid(100,'TAG1',session='s1',seq=2,state_version=v).ack,'ACCEPTED')
  self.assertEqual(a.bid(100,'TAG2',session='s2',seq=2,state_version=v).ack,'STALE')
  self.assertEqual(a.bid_count,1)
 def test_10_seconds_and_off_leader_stays_bound(self):
  a=self.make();a.bid(100,'TAG1',session='s1',seq=2,state_version=a.state_version);a.leave(200,'TAG1',session='s1',seq=3)
  a.tick(10099);self.assertNotEqual(a.phase,'SOLD_LOCKED');a.tick(10100)
  self.assertEqual(a.phase,'SOLD_LOCKED');self.assertEqual(a.result['winnerAlias'],'K7')
 def test_accepted_outbid_restarts_full_10_seconds(self):
  a=self.make();a.bid(0,'TAG1',session='s1',seq=2,state_version=a.state_version)
  a.bid(9999,'TAG2',session='s2',seq=2,state_version=a.state_version)
  a.tick(10000);self.assertEqual(a.phase,'COUNTDOWN');a.tick(19999);self.assertEqual(a.phase,'SOLD_LOCKED');self.assertEqual(a.result['winnerAlias'],'M4')
if __name__=='__main__':unittest.main()
