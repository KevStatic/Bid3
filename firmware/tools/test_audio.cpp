#include "../Gateway/Sounds.h"
#include <cassert>
#include <cstdio>
#include <set>
#include <climits>
unsigned checks=0;
#define CHECK(x) do {assert(x);++checks;} while(0)
int main(){
 Audio::Player p;CHECK(!p.busy());p.tick(0);CHECK(p.hz==0);
 CHECK(p.request(Audio::STARTUP));CHECK(!p.request(Audio::STARTUP));p.tick(100);CHECK(p.hz==1568);
 p.tick(174);CHECK(p.hz==1568);p.tick(175);CHECK(p.hz==0);p.tick(205);CHECK(p.hz==1976);
 CHECK(!p.request(Audio::STARTUP));CHECK(p.request(Audio::NEARBY,1));CHECK(!p.request(Audio::NEARBY,1));
 CHECK(p.request(Audio::VERIFIED,1));CHECK(p.request(Audio::NEARBY,2));CHECK(p.request(Audio::VERIFIED,2));CHECK(!p.request(Audio::NEARBY,3));
 p.stop();CHECK(!p.busy());CHECK(p.hz==0);p.tick(900);CHECK(p.hz==0);
 for(auto k:{Audio::STARTUP,Audio::NEARBY,Audio::VERIFIED}){
  p.stop();CHECK(p.request(k));uint32_t start=UINT_MAX-30;p.tick(start);auto s=Audio::score(k);
  uint32_t total=0;for(int i=0;i<s.count;++i){CHECK(p.hz==s.notes[i].hz);CHECK(s.notes[i].ms>0);total+=s.notes[i].ms;p.tick(start+total);}
  CHECK(!p.busy());CHECK(p.hz==0);
 }
 p.stop();p.request(Audio::STARTUP);p.tick(0);p.tick(5000);CHECK(!p.busy());CHECK(p.hz==0);
 p.request(Audio::NEARBY,1);p.request(Audio::VERIFIED,1);p.tick(10000);CHECK(p.current.kind==Audio::NEARBY);
 p.tick(10230);CHECK(p.current.kind==Audio::VERIFIED);p.tick(10435);CHECK(!p.busy());
 printf("Audio sequence: %u checks passed\n",checks);
}
