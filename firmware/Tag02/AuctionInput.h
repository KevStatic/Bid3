#pragma once
#include <stdint.h>
namespace Bid3 {
class ButtonDebounce {
 bool raw=false,stable=false;uint32_t since=0;
 public:explicit ButtonDebounce(bool initial=false):raw(initial),stable(initial){}
 bool rawLevel()const{return raw;}
 bool sample(bool down,uint32_t now){
  if(down!=raw){raw=down;since=now;}
  if(raw==stable||uint32_t(now-since)<12)return false;
  stable=raw;return stable;
 }
};
}
