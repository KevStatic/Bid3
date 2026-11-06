#include "../Gateway/SoundOutput.h"
#include <cassert>
#include <cstdio>
unsigned count=0;
#define CHECK(x) do {assert(x);++count;} while(0)
int main(){
 SoundOutput s;s.request(Audio::STARTUP);s.tick(0,false);CHECK(!s.player.busy());CHECK(calls.back().op==0&&calls.back().value==INPUT);
 calls.clear();s.request(Audio::STARTUP);s.tick(100,true);CHECK(s.sounding());CHECK(calls[0].op==4&&calls[0].value==8);CHECK(calls[1].op==5&&calls[1].value==1568);
 s.tick(175,true);CHECK(!s.sounding());CHECK(calls.back().op==2&&calls.back().value==0);
 s.tick(205,true);CHECK(s.sounding());CHECK(calls.back().value==1976);
 s.tick(206,false);CHECK(!s.sounding());CHECK(!s.player.busy());CHECK(calls.back().op==0&&calls.back().value==INPUT);
 s.activeModule=true;s.request(Audio::NEARBY);calls.clear();s.tick(300,true);CHECK(s.sounding());CHECK(calls.back().op==1&&calls.back().value==HIGH);
 s.tick(355,true);CHECK(calls.back().value==LOW);s.stop();s.activeLow=true;s.request(Audio::NEARBY);s.tick(400,true);CHECK(calls.back().value==LOW);
 s.tick(455,true);CHECK(calls.back().value==HIGH);s.stop();s.activeModule=false;attachOK=false;s.request(Audio::STARTUP);s.tick(500,true);
 CHECK(calls.back().op==4);attachOK=true;s.tick(501,true);CHECK(calls.back().op==5);toneOK=false;s.tick(606,true);CHECK(!s.player.busy());CHECK(calls.back().op==0);
 for(auto c:calls)CHECK(c.pin==27); // Sound must never write the LED, display or switch pins.
 printf("Sound output mock: %u checks passed (GPIO behavior only; not acoustic hardware)\n",count);
}
