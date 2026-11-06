#pragma once
#include "RuntimePolicy.h"
#include "Sounds.h"
namespace FastFeedback {
inline bool outcome(Audio::Kind kind){return kind==Audio::BID_ACCEPTED||kind==Audio::BID_REJECTED||kind==Audio::SOLD;}
// Both LEDs use the exact sound envelope, including every silent gap.
inline RuntimePolicy::Led leds(Audio::Kind kind,bool sounding,RuntimePolicy::Led idle,unsigned green,unsigned red){
 if(outcome(kind))return sounding?(kind==Audio::BID_REJECTED?RuntimePolicy::Led{0,red}:RuntimePolicy::Led{green,0}):RuntimePolicy::Led{0,0};
 if(sounding)idle.green=green;
 return idle;
}
}
