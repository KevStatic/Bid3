import unittest
from bid3_rules import Auction, Intent, price_at_bid

class Rules(unittest.TestCase):
    def setUp(self):
        self.a=Auction()
        self.count={'K7':0,'M4':0}
        for seat in self.count:
            self.a.bind_session(seat,seat+'-session')
            self.send(seat,'JOIN',0)
    def send(self,seat,kind,now,version=None,price=None,seq=None):
        if seq is None:
            self.count[seat]+=1
            seq=self.count[seat]
        e=Intent(seat,seat+'-session',seq,kind,1,self.a.version if version is None else version,self.a.next_price if price is None else price)
        return self.a.apply(e,now)
    def test_simultaneous(self):
        version,price=self.a.version,self.a.next_price
        self.assertEqual(self.send('K7','BID',100,version,price),'ACCEPTED')
        self.assertEqual(self.send('M4','BID',100,version,price),'STALE')
        self.assertEqual(len(self.a.bids),1)
        self.assertEqual(self.a.price,10000)
    def test_10_second_hammer(self):
        self.send('K7','BID',100)
        self.assertIsNone(self.a.tick(10099))
        self.assertEqual(self.a.tick(10100)['winnerAlias'],'K7')
    def test_bid_restarts_hammer(self):
        self.send('K7','BID',0)
        self.send('M4','BID',9999)
        self.assertIsNone(self.a.tick(10000))
        self.assertEqual(self.a.tick(19999)['winnerAlias'],'M4')
    def test_off_bid_remains_binding(self):
        self.send('K7','BID',0)
        self.send('K7','LEAVE',100)
        self.assertNotIn('K7',self.a.active)
        self.assertEqual(self.a.tick(10000)['winnerAlias'],'K7')
    def test_both_off_bid_still_binding(self):
        self.send('K7','BID',0)
        self.send('K7','LEAVE',10);self.send('M4','LEAVE',20)
        self.assertEqual(self.a.tick(10000)['winnerAlias'],'K7')
    def test_duplicate_exactly_once(self):
        self.assertEqual(self.send('K7','BID',0,0,10000,seq=2),'ACCEPTED')
        self.assertEqual(self.send('K7','BID',1,0,10000,seq=2),'ACCEPTED')
        self.assertEqual(len(self.a.bids),1)
        self.assertEqual(self.send('K7','BID',2,0,10500,seq=2),'INVALID')
    def test_deadline_tie_closes_first(self):
        self.send('K7','BID',0)
        self.assertEqual(self.send('M4','BID',10000),'CLOSED')
    def test_leader_cannot_outbid_self(self):
        self.send('K7','BID',0)
        self.assertEqual(self.send('K7','BID',5),'LEADING')
    def test_pause_no_sale_and_full_restart(self):
        self.send('K7','BID',0);self.a.pause(9900)
        self.assertIsNone(self.a.tick(30000))
        self.a.resume(31000,['K7','M4'])
        self.assertIsNone(self.a.tick(40999))
        self.assertEqual(self.a.tick(41000)['winnerAlias'],'K7')
    def test_no_bid_unsold(self):
        self.assertEqual(self.a.tick(600000)['status'],'UNSOLD')
    def test_last_bid_gets_full_hammer_at_round_cutoff(self):
        self.send('K7','BID',599999)
        self.assertIsNone(self.a.tick(600000))
        self.assertEqual(self.send('M4','BID',600001),'CLOSED')
        self.assertEqual(self.a.tick(609999)['status'],'SOLD')
    def test_one_tag_does_not_open(self):
        self.send('M4','LEAVE',0)
        self.assertEqual(self.send('K7','BID',1),'NOT_OPEN')
    def test_ceiling(self):
        self.a.ceiling=10000
        self.send('K7','BID',0)
        self.assertEqual(self.send('M4','BID',1),'CEILING')
    def test_closed_cannot_reopen(self):
        self.send('K7','BID',0);self.a.tick(10000)
        self.assertEqual(self.send('M4','JOIN',10001),'CLOSED')
    def test_pricing_no_rounding_drift(self):
        self.assertEqual([price_at_bid(10000,500,100000,n) for n in range(4)],[10000,10500,11025,11576])
    def test_wrong_session(self):
        e=Intent('K7','old-session',20,'BID',1,0,10000)
        self.assertEqual(self.a.apply(e,1),'INVALID')
    def test_reentry(self):
        self.send('K7','BID',0);self.send('M4','LEAVE',1)
        self.send('M4','JOIN',2)
        self.assertEqual(self.send('M4','BID',3),'ACCEPTED')

if __name__=='__main__':unittest.main()
