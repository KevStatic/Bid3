#define INPUT 0x01 // Arduino macro must not collide with our wire constants.
#include "../shared/FastWire.h"
#undef INPUT
#include "../Gateway/Visuals.h"
#include <cassert>
#include <cstdio>
unsigned checks=0;
#define CHECK(x) do{assert(x);++checks;}while(0)
int main(){
 uint8_t p[Fast::INPUT_PACKET_SIZE]={0},nonce[32]={0},boot[8]={0};
 memcpy(p,"B5I1",4);p[4]=1;p[5]=1;p[6]=Fast::PRESS;p[7]=1;Fast::put32(p+40,1);Fast::put32(p+52,1);
 CHECK(Fast::inputFields(p,sizeof(p),1,nonce,boot));
 for(unsigned i=0;i<8;++i){p[i]^=0x80;CHECK(!Fast::inputFields(p,sizeof(p),1,nonce,boot));p[i]^=0x80;}
 for(unsigned i=8;i<40;++i){p[i]^=1;CHECK(!Fast::inputFields(p,sizeof(p),1,nonce,boot));p[i]^=1;}
 for(unsigned i=56;i<64;++i){p[i]^=1;CHECK(!Fast::inputFields(p,sizeof(p),1,nonce,boot));p[i]^=1;}
 CHECK(!Fast::inputFields(p,sizeof(p)-1,1,nonce,boot));CHECK(!Fast::inputFields(p,sizeof(p),2,nonce,boot));
 Fast::put32(p+40,0);CHECK(!Fast::inputFields(p,sizeof(p),1,nonce,boot));Fast::put32(p+40,1);
 Fast::InputWindow window;CHECK(window.eligible(p));window.commit(p);CHECK(!window.eligible(p));
 p[7]=0;Fast::put32(p+40,2);CHECK(window.eligible(p));window.commit(p); // release with unchanged count
 Fast::put32(p+52,0);Fast::put32(p+40,3);CHECK(!window.eligible(p));
 View v;CHECK(applyInput(v,0,1,1,true,100,100));CHECK(v.event==6&&v.eventTag==1);CHECK(!v.sold);
 CHECK(!applyInput(v,0,1,1,true,100,101)); // duplicate cannot retrigger
 v.event=4;CHECK(!applyInput(v,0,1,1,false,110,110));CHECK(v.event==4&&!v.tags[0].buttonHeld);
 CHECK(applyInput(v,1,1,1,true,120,120));CHECK(v.eventTag==2); // simultaneous second tag remains represented
 CHECK(!applyInput(v,0,1,0,true,121,121));CHECK(!applyInput(v,2,1,1,true,121,121));
 CHECK(!applyInput(v,0,1,2,true,100,1000)); // stale UI work ignored
 CHECK(applyInput(v,0,2,1,true,130,130)); // fresh session can reset count
 Canvas c,expected;drawVisual(c,v,130,130,"BID3");expected.clear();expected.center(2,"BUTTON PRESSED");
 for(unsigned y=2;y<9;++y)for(unsigned x=0;x<128;++x){CHECK((c.pixels[x+(y/8)*128]&(1u<<(y%8)))==(expected.pixels[x+(y/8)*128]&(1u<<(y%8))));}
 v.event=4;drawVisual(c,v,150,150,"BID3"); // Engine result does not erase the initial 80ms input feedback.
 for(unsigned y=2;y<9;++y)for(unsigned x=0;x<128;++x)CHECK((c.pixels[x+(y/8)*128]&(1u<<(y%8)))==(expected.pixels[x+(y/8)*128]&(1u<<(y%8))));
 for(uint32_t now=130;now<4000;now+=10)drawVisual(c,v,now,now,"BID3");
 std::printf("Live input: %u field/replay/session/pressed-release/OLED checks passed\n",checks);
}
