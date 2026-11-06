#pragma once
#include "RuntimePolicy.h"
#include "Sounds.h"
namespace FastFeedback {
inline bool outcome(Audio::Kind kind){return kind==Audio::BID_ACCEPTED||kind==Audio::BID_REJECTED||kind==Audio::SOLD;}
inline bool cosmetic(Audio::Kind kind){return kind==Audio::NEARBY||kind==Audio::VERIFIED;}
// Discovery history must survive OFF/LOST clearing the OLED's presence flags.
struct Discovery {
 bool radioKnown=false,proofKnown=false;uint32_t radioAt=0,proofAt=0;
 bool radio(uint32_t now,uint32_t absence){bool arrived=!radioKnown||uint32_t(now-radioAt)>=absence;radioKnown=true;radioAt=now;return arrived;}
 bool proof(uint32_t now,uint32_t absence){bool verified=!proofKnown||uint32_t(now-proofAt)>=absence;proofKnown=true;proofAt=now;return verified;}
};
// Loss invalidates cosmetic cues, never a recorded engine decision or startup.
inline bool allow(Audio::Kind kind,uint32_t queuedEpoch,uint32_t lossEpoch,bool online){
 return !cosmetic(kind)||(queuedEpoch==lossEpoch&&(lossEpoch==0||online));
}
// Both LEDs use the exact sound envelope, including every silent gap.
inline RuntimePolicy::Led leds(Audio::Kind kind,bool sounding,RuntimePolicy::Led idle,unsigned green,unsigned red){
 if(outcome(kind))return sounding?(kind==Audio::BID_REJECTED?RuntimePolicy::Led{0,red}:RuntimePolicy::Led{green,0}):RuntimePolicy::Led{0,0};
 if(sounding)idle.green=green;
 return idle;
}
}
