#pragma once
#include <stdint.h>
#include <limits.h>

// Portable, sampled active-low input policy. Call at least every few milliseconds.
// A stable press increments once; release must debounce before another press.
namespace ButtonInput {
constexpr uint32_t DEBOUNCE_MS = 30;
struct Snapshot {
  uint32_t count=0, lastPressAt=0;
  bool pressed=false, overflow=false;
};
class Debouncer {
  bool raw=false;
  uint32_t changedAt=0;
  Snapshot value;
 public:
  void sample(bool pressed,uint32_t now) {
    if(pressed!=raw){raw=pressed;changedAt=now;}
    if(uint32_t(now-changedAt)<DEBOUNCE_MS||value.pressed==raw)return;
    value.pressed=raw;
    if(raw){
      if(value.count==UINT32_MAX){value.overflow=true;return;}
      ++value.count;value.lastPressAt=now;
    }
  }
  Snapshot snapshot()const{return value;}
};
}
