"""Executable auction policy reference, not a hosted engine or persistence layer.
The real engine must run these transitions inside one durable ordered transaction.
All incoming amounts are integers; now_ms must be the engine's monotonic clock.
"""
from dataclasses import dataclass
import hashlib
import json

MAX_SAFE = (1 << 53) - 1

def price_at_bid(start_minor, step_bps, ceiling_minor, bid_index):
    if not (0 < start_minor <= ceiling_minor <= MAX_SAFE and step_bps in (200, 500, 700, 1000) and 0 <= bid_index <= 10000):
        raise ValueError('invalid price ladder')
    num = start_minor * (10000 + step_bps) ** bid_index
    den = 10000 ** bid_index
    q, r = divmod(num, den)
    return min(ceiling_minor, q + (2 * r >= den))

def rules_hash(r):
    keys = ('auctionId','epoch','listingId','startPriceMinor','stepBps','countdownMs','ceilingMinor','timeLimitMs','unit')
    return '0x' + hashlib.sha256(json.dumps({k:r[k] for k in keys},separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

@dataclass(frozen=True)
class Intent:
    seat: str
    session: str
    seq: int
    kind: str
    epoch: int
    quote_version: int
    price_minor: int

class Auction:
    """One auction epoch. Identity/signature/session freshness are checked before apply.
    Process accepted-before-deadline inputs before tick, using one ingestion order.
    Exact deadline ties close first. OFF never cancels an accepted leading bid.
    """
    def __init__(self, auction_id='bid3-001', epoch=1, start=10000, step=500, ceiling=100000,
                 time_limit_ms=600000, now_ms=0, eligible=('K7','M4')):
        price_at_bid(start, step, ceiling, 0)
        if time_limit_ms < 10000:
            raise ValueError('round limit must permit a hammer interval')
        self.auction_id, self.epoch = auction_id, epoch
        self.start, self.step, self.ceiling = start, step, ceiling
        self.countdown_ms = 10000
        self.deadline_round = now_ms + time_limit_ms
        self.phase = 'LOBBY'
        self.active = set()
        self.eligible = set(eligible)
        self.sessions = {}
        self.version = self.seq = self.generation = 0
        self.bids = []
        self.price = self.next_price = start
        self.leader = None
        self.deadline = None
        self.competed = False
        self.result = None
        self.decisions = {}
        self.last_session_seq = {}
        self.pause_at = None
        self.last_now = now_ms

    def bind_session(self, seat, session):
        if seat not in self.eligible or self.result:
            raise ValueError('ineligible or closed')
        self.sessions[seat] = session

    def _clock(self, now):
        if now < self.last_now:
            raise ValueError('engine time must not run backwards')
        self.last_now = now

    def pause(self, now):
        self._clock(now)
        if self.result or self.phase == 'PAUSED':
            return
        self.pause_at = now
        self.phase = 'PAUSED'
        self.deadline = None
        self.generation += 1

    def resume(self, now, verified_active):
        self._clock(now)
        if self.phase != 'PAUSED' or not set(verified_active) <= self.eligible:
            raise ValueError('fresh resynchronization required')
        self.deadline_round += now - self.pause_at
        self.active = set(verified_active)
        self.phase = 'COUNTDOWN' if self.leader else ('OPEN' if len(self.active)>=2 else 'LOBBY')
        if self.leader:
            self.deadline = now + self.countdown_ms
            self.generation += 1
        self.version += 1  # Invalidates pre-pause price tokens; never auto-reprice a press.

    def tick(self, now):
        self._clock(now)
        if self.result or self.phase == 'PAUSED':
            return self.result
        # Time limit closes admission; a standing bid gets its full hammer interval.
        if self.deadline is not None and now >= self.deadline:
            self.phase = 'SOLD_LOCKED'
            self.result = dict(status='SOLD',winnerAlias=self.leader,hammerPriceMinor=self.price,
                               finalSeq=self.seq,bidCount=len(self.bids),generation=self.generation)
        elif now >= self.deadline_round and not self.leader:
            self.phase = 'UNSOLD'
            self.result = dict(status='UNSOLD',winnerAlias=None,hammerPriceMinor=0,finalSeq=self.seq,bidCount=0)
        return self.result

    def apply(self, event, now):
        self._clock(now)
        identity = (event.seat,event.session,event.seq)
        if identity in self.decisions:
            prior_event, decision = self.decisions[identity]
            return decision if prior_event == event else 'INVALID'
        if (event.epoch != self.epoch or self.sessions.get(event.seat) != event.session
            or event.seat not in self.eligible or event.seq <= self.last_session_seq.get((event.seat,event.session),0)):
            return 'INVALID'
        self.tick(now)
        reason = 'ACCEPTED'
        if self.result:
            reason = 'CLOSED'
        elif self.phase == 'PAUSED' and event.kind not in ('JOIN','LEAVE'):
            reason = 'UNHEALTHY'
        elif event.kind == 'JOIN':
            self.active.add(event.seat)
            self.competed |= len(self.active) >= 2
            if not self.leader and self.phase != 'PAUSED':
                self.phase = 'OPEN' if len(self.active)>=2 else 'LOBBY'
        elif event.kind == 'LEAVE':
            self.active.discard(event.seat)
            if not self.leader and self.phase != 'PAUSED':
                self.phase = 'OPEN' if len(self.active)>=2 else 'LOBBY'
        elif event.kind == 'BID':
            if now >= self.deadline_round:
                reason = 'CLOSED'
            elif event.seat not in self.active:
                reason = 'NOT_ACTIVE'
            elif not self.competed or self.phase not in ('OPEN','COUNTDOWN'):
                reason = 'NOT_OPEN'
            elif event.quote_version != self.version or event.price_minor != self.next_price:
                reason = 'STALE'
            elif event.seat == self.leader:
                reason = 'LEADING'
            elif self.leader is not None and self.price >= self.ceiling:
                reason = 'CEILING'
            else:
                self.price = self.next_price
                self.leader = event.seat
                self.seq += 1
                self.version += 1
                self.bids.append(dict(serverSeq=self.seq,bidIndex=len(self.bids),priceMinor=self.price,
                                      bidderAlias=event.seat,acceptedAtMs=now))
                self.next_price = price_at_bid(self.start,self.step,self.ceiling,len(self.bids))
                self.phase = 'COUNTDOWN'
                self.deadline = now + self.countdown_ms
                self.generation += 1
        else:
            reason = 'INVALID'
        self.last_session_seq[(event.seat,event.session)] = event.seq
        self.decisions[identity] = (event,reason)
        return reason
