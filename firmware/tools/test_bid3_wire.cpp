#include "../shared/AuctionWire.h"
#include "../shared/AuctionInput.h"
#include <cassert>
#include <iostream>
int main(){
 using namespace Bid3;unsigned checks=0;
 ButtonDebounce b;
 assert(!b.sample(true,0));assert(!b.sample(false,4));assert(!b.sample(true,6));
 assert(!b.sample(true,17));assert(b.sample(true,18));assert(!b.sample(true,1000));
 assert(!b.sample(false,1001));assert(!b.sample(true,1004));assert(!b.sample(true,1016));
 assert(!b.sample(false,1020));assert(!b.sample(false,1032));
 assert(!b.sample(true,1040));assert(b.sample(true,1052));checks+=13;
 ButtonDebounce held(true);assert(!held.sample(true,100));++checks;
 ButtonDebounce wrap;assert(!wrap.sample(true,UINT32_MAX-5));assert(wrap.sample(true,6));checks+=2;
 uint8_t frame[SIGNED],other[SIGNED];init(frame,BID,1);
 assert(header(frame,SIGNED));++checks;
 for(uint32_t n: {0u,1u,10000u,UINT32_MAX}){put32(frame+106,n);assert(u32(frame+106)==n);++checks;}
 for(uint64_t n: {uint64_t(0),uint64_t(11576),uint64_t(9007199254740991ULL),UINT64_MAX}){put64(frame+114,n);assert(u64(frame+114)==n);++checks;}
 memcpy(other,frame,SIGNED);assert(bound(frame,other));++checks;
 for(unsigned i=8;i<106;++i){other[i]^=1;assert(!bound(frame,other));other[i]^=1;++checks;}
 other[106]^=1;assert(bound(frame,other));++checks; // Quote token checked separately by engine.
 for(unsigned t=0;t<1000;++t){auto a=feedback(ACCEPTED,t),r=feedback(STALE,t);
  assert((a.green>0)==(a.hz>0)&&a.red==0);
  assert((r.red>0)==(r.hz>0)&&r.green==0);checks+=2;
 }
 assert(!feedback(ACCEPTED,65).hz);++checks;
 assert(!newer(0,UINT32_MAX));++checks;
 std::cout<<checks<<" wire/feedback checks passed\n";
}
