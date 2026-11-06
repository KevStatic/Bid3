#pragma once
#include <stdint.h>
// Hardware-independent, non-blocking score player. A rest has frequency zero.
namespace Audio {
enum Kind : uint8_t { NONE, STARTUP, NEARBY, VERIFIED, BID_ACCEPTED, BID_REJECTED, SOLD };
struct Note {uint16_t hz,ms;};
constexpr Note startup[]={{1568,75},{0,30},{1976,75},{0,30},{2349,110},{0,55},{2093,65},{0,25},{2637,170},{0,45}};
constexpr Note nearby[]={{1760,55},{0,40},{2093,90},{0,45}};
constexpr Note verified[]={{2349,45},{0,30},{2637,85},{0,45}};
constexpr Note bidAccepted[]={{2349,65},{0,10}};
constexpr Note bidRejected[]={{880,40},{0,40},{880,40},{0,40},{880,40},{0,40}};
constexpr Note sold[]={{2637,100},{0,60},{2637,100},{0,60},{2637,100},{0,60}};
struct Score {const Note*notes;uint8_t count;};
inline Score score(Kind k){
 switch(k){case BID_ACCEPTED:return {bidAccepted,uint8_t(sizeof(bidAccepted)/sizeof(Note))};
 case BID_REJECTED:return {bidRejected,uint8_t(sizeof(bidRejected)/sizeof(Note))};
 case SOLD:return {sold,uint8_t(sizeof(sold)/sizeof(Note))};
 case STARTUP:return {startup,uint8_t(sizeof(startup)/sizeof(Note))};
 case NEARBY:return {nearby,uint8_t(sizeof(nearby)/sizeof(Note))};
 case VERIFIED:return {verified,uint8_t(sizeof(verified)/sizeof(Note))};default:return {nullptr,0};}
}
struct Request {Kind kind=NONE;uint8_t tag=0;};
class Player {
 Request queue[4];uint8_t used=0,index=0;uint32_t noteAt=0;
 bool startNext(uint32_t now){if(!used)return false;current=queue[0];for(int i=1;i<used;++i)queue[i-1]=queue[i];--used;index=0;noteAt=now;return true;}
public:
 Request current;uint16_t hz=0;
 void stop(){used=0;index=0;current={};hz=0;}
 bool busy()const{return current.kind!=NONE||used;}
 bool request(Kind kind,uint8_t tag=0){
  if(kind==NONE)return false;
  if(current.kind==kind&&current.tag==tag)return false;
  for(int i=0;i<used;++i)if(queue[i].kind==kind&&queue[i].tag==tag)return false;
  if(used==4)return false;queue[used++]={kind,tag};return true;
 }
 void tick(uint32_t now){
  if(current.kind==NONE&&!startNext(now)){hz=0;return;}
  Score s=score(current.kind);
  while(uint32_t(now-noteAt)>=s.notes[index].ms){
   noteAt+=s.notes[index].ms;
   if(++index==s.count){current={};if(!startNext(now)){hz=0;return;}s=score(current.kind);}
  }
  hz=s.notes[index].hz;
 }
};
}
