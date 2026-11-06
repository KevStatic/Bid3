#pragma once
#include <stdint.h>
namespace RuntimePolicy {
// Unsigned subtraction keeps elapsed timers valid across millis() wraparound.
inline bool elapsed(uint32_t now,uint32_t then,uint32_t delay){return uint32_t(now-then)>=delay;}
struct Retry {
 bool attempted=false;uint32_t at=0,wait=0;uint8_t failures=0;
 bool due(uint32_t now)const{return !attempted||elapsed(now,at,wait);}
 void finish(uint32_t now,bool success,uint32_t normal){attempted=true;at=now;
  if(success){failures=0;wait=normal;}else{if(failures<4)++failures;wait=uint32_t(500)<<(failures-1);if(wait>4000)wait=4000;}}
};
inline int selectTag(uint32_t now,int next,const bool seen[2],const uint32_t lastSeen[2],const Retry retry[2]){
 for(int n=0;n<2;++n){int tag=(next+n)%2;if(seen[tag]&&uint32_t(now-lastSeen[tag])<=5000&&retry[tag].due(now))return tag;}return -1;
}
struct Led {unsigned green,red;};
inline Led leds(uint32_t now,bool peripheral,bool fatal,bool radioReady,unsigned freshTags,bool sensorWarning,bool reject,unsigned greenMax,unsigned redMax){
 if(!peripheral)return {0,0};
 if(fatal)return {0,redMax};
 if(reject)return {0,(now%500)<100||((now%500)>=180&&(now%500)<280)?redMax:0};
 unsigned phase=now%1800;unsigned triangle=phase<900?phase:1800-phase;
 unsigned breathe=6+triangle*(greenMax-6)/900;
 if(!radioReady||freshTags==0)return {0,4+triangle*(redMax-4)/900};
 if(freshTags==1||sensorWarning){unsigned p=now%2400;return {breathe,(p<85||(p>=190&&p<275))?redMax:0};}
 return {breathe,0};
}
}
