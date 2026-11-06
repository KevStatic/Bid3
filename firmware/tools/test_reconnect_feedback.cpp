#include "../Gateway/Visuals.h"
#include "../Gateway/FastFeedback.h"
#include "../Gateway/SoundOutput.h"
#include <cassert>
#include <cstdio>
#include <climits>

unsigned checks=0;
#define CHECK(x) do {assert(x);++checks;} while(0)

int main(){
 // Reproduce the failure: LOST clears seen on every UI update, with ads at 10 Hz.
 // The sound history survives those updates and repeated proof negotiation.
 View view;FastFeedback::Discovery discovery[2];Audio::Player player;
 unsigned arrivals=0,proofs=0,audibleMs=0;
 for(uint32_t now=1000;now<11000;++now){
  if(now%100==0){
   if(discovery[0].radio(now,Config::TAG_RETURN_MS)){++arrivals;player.request(Audio::NEARBY,1);}
   view.tags[0].seen=true;view.tags[0].lastRadio=now;
  }
  if(now%2000==0&&discovery[0].proof(now,Config::FRESH_MS))++proofs;
  applyAvailability(view,0,false,true,true,now);
  CHECK(!view.tags[0].seen);CHECK(!tagPresent(view.tags[0]));
  player.tick(now);if(player.hz)++audibleMs;
 }
 CHECK(arrivals==1);CHECK(proofs==1);CHECK(audibleMs==145);CHECK(!player.busy());
 CHECK(discovery[1].radio(11000,Config::TAG_RETURN_MS)); // Other tag has independent history.
 CHECK(!discovery[0].radio(11000,Config::TAG_RETURN_MS));
 CHECK(discovery[0].radio(26000,Config::TAG_RETURN_MS)); // Genuine 15 s absence still detected.
 CHECK(!discovery[0].proof(26000,Config::FRESH_MS));
 CHECK(discovery[0].proof(51000,Config::FRESH_MS));
 FastFeedback::Discovery wrap;
 CHECK(wrap.radio(UINT_MAX-100,15000));CHECK(!wrap.radio(100,15000));CHECK(wrap.radio(15100,15000));
 CHECK(wrap.proof(UINT_MAX-100,25000));CHECK(!wrap.proof(100,25000));CHECK(wrap.proof(25100,25000));

 // Every queued pre-loss discovery cue is rejected, even after fast recovery.
 for(auto kind:{Audio::NEARBY,Audio::VERIFIED}){
  CHECK(FastFeedback::allow(kind,0,0,false)); // Original cold-start feedback.
  CHECK(!FastFeedback::allow(kind,0,1,false));
  CHECK(!FastFeedback::allow(kind,0,1,true));
  CHECK(!FastFeedback::allow(kind,1,1,false));
  CHECK(FastFeedback::allow(kind,1,1,true));
 }
 for(auto kind:{Audio::STARTUP,Audio::BID_ACCEPTED,Audio::BID_REJECTED,Audio::SOLD,Audio::NONE})
  CHECK(FastFeedback::allow(kind,0,9,false));

 // Loss cancels both the sounding chirp and queued cosmetics for only that tag.
 player.stop();player.request(Audio::NEARBY,1);player.request(Audio::VERIFIED,1);
 player.request(Audio::VERIFIED,2);player.request(Audio::BID_ACCEPTED,1);player.tick(100);
 CHECK(player.hz==1760);player.cancelCosmetic(1);CHECK(player.hz==0);
 player.tick(101);CHECK(player.current.kind==Audio::VERIFIED&&player.current.tag==2);
 player.tick(306);CHECK(player.current.kind==Audio::BID_ACCEPTED&&player.current.tag==1);
 player.cancelCosmetic(1);CHECK(player.current.kind==Audio::BID_ACCEPTED);
 player.tick(381);CHECK(!player.busy());
 for(auto kind:{Audio::STARTUP,Audio::BID_ACCEPTED,Audio::BID_REJECTED,Audio::SOLD}){
  player.stop();player.request(kind,1);player.request(Audio::VERIFIED,1);player.tick(100);
  player.cancelCosmetic(1);CHECK(player.current.kind==kind);
  player.tick(5100);CHECK(!player.busy()&&player.hz==0);
 }

 // Actual sound driver writes silence on its next tick; green overlay ends too.
 for(bool activeModule:{false,true})for(bool activeLow:{false,true}){
  SoundOutput sound;sound.activeModule=activeModule;sound.activeLow=activeLow;
  sound.request(Audio::NEARBY,1);sound.tick(100,true);CHECK(sound.sounding());
  sound.player.cancelCosmetic(1);sound.tick(101,true);CHECK(!sound.sounding());
  CHECK(calls.back().value==(activeModule&&activeLow?HIGH:0));
  auto idle=RuntimePolicy::leds(101,true,false,true,0,false,false,38,26);
  auto led=FastFeedback::leds(sound.player.current.kind,sound.sounding(),idle,38,26);
  CHECK(led.green==0&&led.red>0);sound.stop();
 }
 // A healthy remaining tag keeps its ordinary idle indication, without audio.
 auto healthy=RuntimePolicy::leds(500,true,false,true,1,false,false,38,26);
 CHECK(healthy.green>0);
 std::printf("Reconnect feedback: %u checks passed; 100 advertisements produced one finite arrival cue, not repeated chirps.\n",checks);
}
