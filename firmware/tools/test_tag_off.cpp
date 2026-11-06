#include "../shared/FastWire.h"
#include "../Gateway/Visuals.h"
#include <cassert>
#include <cstdio>
#include <climits>
unsigned checks=0;
#define CHECK(x) do{assert(x);++checks;}while(0)
int main(){
 Fast::SwitchState state;
 CHECK(state.observe(true,100));CHECK(state.known&&state.on);
 CHECK(state.observe(false,150));CHECK(!state.on);
 CHECK(!state.observe(true,149));CHECK(!state.on); // A delayed old JOIN cannot resurrect OFF.
 CHECK(!state.observe(false,151));CHECK(state.at==151);
 CHECK(state.observe(true,200));CHECK(state.on);
 state={};CHECK(state.observe(true,UINT_MAX-10));CHECK(state.observe(false,5));CHECK(!state.on);
 CHECK(!state.observe(true,UINT_MAX-5));CHECK(!state.on); // Uptime wrap ordering.
 uint8_t p[Fast::HEARTBEAT]={0},nonce[32]={0},boot[8]={0};
 memcpy(p,"B4H1",4);p[4]=1;p[5]=1;p[7]=1;Fast::put32(p+40,1);
 CHECK(Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));p[7]=0;CHECK(Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));
 p[7]=2;CHECK(!Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));p[7]=0;
 p[6]=Fast::BID;CHECK(!Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));p[6]=0;
 for(unsigned i=8;i<40;++i){p[i]^=1;CHECK(!Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));p[i]^=1;}
 for(unsigned i=56;i<64;++i){p[i]^=1;CHECK(!Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));p[i]^=1;}
 CHECK(!Fast::heartbeatFields(p,sizeof(p)-1,1,nonce,boot));CHECK(!Fast::heartbeatFields(p,sizeof(p),2,nonce,boot));
 Fast::put32(p+40,0);CHECK(!Fast::heartbeatFields(p,sizeof(p),1,nonce,boot));
 View v;
 for(auto&t:v.tags){t.verified=t.seen=true;t.lastProof=t.lastRadio=5000;}
 CHECK(applyAvailability(v,0,true,true,true,5000));CHECK(applyAvailability(v,1,true,true,true,5000));
 CHECK(fresh(v.tags[0],5000)&&fresh(v.tags[1],5000));
 CHECK(applyInput(v,0,1,1,true,5001,5001));
 CHECK(applyAvailability(v,0,true,true,false,5002));
 CHECK(v.event==7&&v.eventTag==1&&!v.inputActive);
 CHECK(!tagPresent(v.tags[0])&&!fresh(v.tags[0],5002)&&!v.tags[0].seen);
 CHECK(fresh(v.tags[1],5002)); // OFF isolates only its own tag.
 CHECK(!applyInput(v,0,1,2,true,5003,5003));
 Canvas c,expected;drawVisual(c,v,5003,5003,"BID3");expected.clear();expected.center(3,"TAG SWITCHED OFF");
 for(unsigned y=3;y<10;++y)for(unsigned x=0;x<128;++x)CHECK((c.pixels[x+(y/8)*128]&(1u<<(y%8)))==(expected.pixels[x+(y/8)*128]&(1u<<(y%8))));
 CHECK(!applyAvailability(v,0,true,true,false,5004));CHECK(v.eventAt==5002); // Repeated heartbeats do not retrigger animation.
 CHECK(applyAvailability(v,1,false,true,true,5005));CHECK(!fresh(v.tags[1],5005));CHECK(v.event==8&&v.eventTag==2); // Radio failure ignores old 25-second proof freshness.
 CHECK(!applyInput(v,1,1,1,true,5006,5006));
 CHECK(applyAvailability(v,1,true,true,true,5007));CHECK(fresh(v.tags[1],5007));
 CHECK(applyInput(v,1,1,1,true,5008,5008)); // Healthy tag's V5 button path still works.
 CHECK(applyAvailability(v,0,true,true,true,5009));v.tags[0].seen=true;v.tags[0].lastProof=5009;CHECK(fresh(v.tags[0],5009));
 CHECK(applyAvailability(v,0,true,true,false,5010));CHECK(applyAvailability(v,1,true,true,false,5011));
 CHECK(!fresh(v.tags[0],5011)&&!fresh(v.tags[1],5011));
 for(unsigned frame=0;frame<2000;++frame)drawVisual(c,v,5012+frame*10,5012+frame*10,"BID3");
 std::printf("Tag OFF/LOST: %u switch-order/heartbeat/availability/OLED checks passed\n",checks);
}
