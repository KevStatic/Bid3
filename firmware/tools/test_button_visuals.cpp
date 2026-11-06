#include "../Gateway/Visuals.h"
#include <cstdio>
int main(){
  Canvas c;View v;v.radioReady=true;
  // Actual new UI path: baseline/counts, both tags, largest counters and invalid IDs.
  for(unsigned tag=0;tag<4;++tag){
    v.event=3;v.eventTag=tag;v.eventAt=4000;
    for(auto&q:v.tags){q.buttonKnown=true;q.buttonCount=UINT32_MAX;q.buttonHeld=tag&1;}
    for(unsigned age=0;age<=2300;age+=10)drawVisual(c,v,4000+age,4000+age,"BID3");
  }
  v.event=0;
  for(unsigned frame=0;frame<240;++frame){
    const uint32_t now=frame*100;drawVisual(c,v,now,now,"BID3");
  }
  std::puts("PASS: 1164 actual new/existing OLED renderer frames under sanitizers");
}
