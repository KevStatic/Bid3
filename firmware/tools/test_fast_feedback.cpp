#include "../Gateway/FastFeedback.h"
#include <cassert>
#include <cstdio>
#include <initializer_list>
int main(){unsigned checks=0;
 for(auto kind:{Audio::BID_ACCEPTED,Audio::BID_REJECTED,Audio::SOLD}){
  Audio::Player player;assert(player.request(kind));
  auto score=Audio::score(kind);unsigned duration=0;for(unsigned i=0;i<score.count;++i)duration+=score.notes[i].ms;
  for(unsigned t=0;t<=duration;++t){player.tick(t);bool sounding=player.hz>0;
   auto led=FastFeedback::leds(player.current.kind,sounding,{0,0},38,26);
   assert((led.green>0||led.red>0)==sounding);++checks;
   if(player.current.kind==Audio::BID_REJECTED){assert(led.green==0);++checks;}
   else{assert(led.red==0);++checks;}
  }
 }
 std::printf("%u bid/sold LED and sound envelope checks passed\n",checks);
}
