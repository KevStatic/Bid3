#pragma once
#include <stdint.h>
#include <cstring>

namespace ButtonTracker {
enum Kind:uint8_t { INVALID=0, BASELINE=1, UNCHANGED=2, PRESS=3, LEVEL=4 };
struct Decision {Kind kind=INVALID;uint32_t delta=0;};
struct State {
  bool initialized=false, pressed=false;
  uint8_t boot[8]={0};uint32_t count=0, sequence=0;
  Decision inspect(const uint8_t newBoot[8],uint32_t newCount,uint32_t newSequence,bool held)const{
    if(!newSequence)return {};
    if(!initialized||memcmp(boot,newBoot,8))return {BASELINE,0};
    if(newSequence<=sequence||newCount<count)return {};
    if(newCount>count)return {PRESS,newCount-count};
    return {held!=pressed?LEVEL:UNCHANGED,0};
  }
  void commit(const uint8_t newBoot[8],uint32_t newCount,uint32_t newSequence,bool held){
    initialized=true;memcpy(boot,newBoot,8);count=newCount;sequence=newSequence;pressed=held;
  }
};
}
