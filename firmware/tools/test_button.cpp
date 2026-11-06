#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "../shared/ButtonInput.h"
#include "../Gateway/ButtonTracker.h"
#include "../Gateway/ButtonWire.h"
static unsigned checks=0;
static void check(bool ok){++checks;if(!ok){std::fprintf(stderr,"FAIL check %u\n",checks);std::exit(1);}}
int main(){
  ButtonInput::Debouncer b;
  for(uint32_t t=0;t<100;t+=5)b.sample(false,t);
  check(b.snapshot().count==0&&!b.snapshot().pressed);
  // Several bouncing edges followed by a stable press: one event.
  b.sample(true,100);b.sample(false,105);b.sample(true,110);b.sample(false,115);b.sample(true,120);
  b.sample(true,149);check(b.snapshot().count==0);
  b.sample(true,150);check(b.snapshot().count==1&&b.snapshot().pressed);
  for(uint32_t t=155;t<1000;t+=5){b.sample(true,t);check(b.snapshot().count==1);}
  // Release bounce cannot re-arm the input until release is stable.
  b.sample(false,1000);b.sample(true,1005);b.sample(false,1010);b.sample(false,1040);
  check(!b.snapshot().pressed&&b.snapshot().count==1);
  b.sample(true,1100);b.sample(true,1130);check(b.snapshot().count==2);
  b.sample(false,1140);b.sample(false,1170);check(!b.snapshot().pressed);
  // A pulse shorter than debounce is deliberately ignored.
  b.sample(true,1200);b.sample(false,1210);b.sample(false,1250);check(b.snapshot().count==2);
  ButtonInput::Debouncer wrap;
  wrap.sample(true,UINT32_MAX-10);wrap.sample(true,18);check(wrap.snapshot().count==0);
  wrap.sample(true,19);check(wrap.snapshot().count==1);
  // Actual tracker prevents duplicate reports and distinguishes a new-boot baseline.
  ButtonTracker::State state;uint8_t boot[8]={1},other[8]={2};
  check(state.inspect(boot,4,1,false).kind==ButtonTracker::BASELINE);
  state.commit(boot,4,1,false);
  check(state.inspect(boot,4,1,false).kind==ButtonTracker::INVALID);
  check(state.inspect(boot,3,2,false).kind==ButtonTracker::INVALID);
  check(state.inspect(boot,4,2,false).kind==ButtonTracker::UNCHANGED);
  check(state.inspect(boot,4,2,true).kind==ButtonTracker::LEVEL);
  auto d=state.inspect(boot,7,2,false);check(d.kind==ButtonTracker::PRESS&&d.delta==3);
  state.commit(boot,7,2,false);check(state.inspect(boot,7,3,false).kind==ButtonTracker::UNCHANGED);
  check(state.inspect(other,0,1,false).kind==ButtonTracker::BASELINE);
  check(state.inspect(other,0,0,false).kind==ButtonTracker::INVALID);
  // Exercise the actual C++ wire validator, including invalid sensor sentinels.
  uint8_t p[199]={0},request[84]={0},device[6]={3,4,5,6,7,8};
  memcpy(p,"BTP1",4);p[4]=1;p[5]=1;memcpy(p+8,device,6);p[22]=1;
  p[30]=255;p[31]=255;for(int i=0;i<7;++i){p[32+2*i]=0;p[33+2*i]=128;}
  memcpy(request,"BTB1",4);for(int i=4;i<84;++i)request[i]=uint8_t(i);
  memcpy(p+46,request+4,80);
  auto valid=[&](){return ButtonWire::fieldsMatch(p,sizeof(p),0,device,request,true,100);};
  check(valid());p[134]=2;check(!valid());p[134]=0;
  p[130]=1;check(!valid());p[126]=1;check(valid());p[130]=0;
  check(!ButtonWire::fieldsMatch(p,198,0,device,request,true,100));
  check(!ButtonWire::fieldsMatch(p,199,0,device,request,false,100));
  check(!ButtonWire::fieldsMatch(p,199,0,device,request,true,5001));
  for(int i=46;i<126;++i){p[i]^=1;check(!valid());p[i]^=1;}
  std::printf("PASS: %u actual debounce/tracker/wire checks\n",checks);
}
