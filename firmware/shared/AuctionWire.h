#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace Bid3 {
constexpr size_t BODY=132, SIGNED=196, MACED=148;
constexpr char SERVICE[]="b7610001-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char INFO[]="b7610006-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char CONTROL[]="b7610007-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char EVENTS[]="b7610008-7e1d-4e8b-9a73-8f1b0c4d9000";
enum Kind:uint8_t { ARM=1,QUOTE=2,ACK=3,PAUSE=4,CLOSE=5,JOIN=16,LEAVE=17,BID=18,HELLO=19,HEARTBEAT=20 };
enum Reason:uint8_t { ACCEPTED=0,STALE=1,LEADING=2,NOT_ACTIVE=3,NOT_OPEN=4,CLOSED=5,CEILING=6,UNHEALTHY=7,INVALID=8 };
enum Phase:uint8_t { LOBBY=0,OPEN=1,COUNTDOWN=2,PAUSED=3,LOCKED=4 };
inline uint32_t u32(const uint8_t*p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline uint64_t u64(const uint8_t*p){return uint64_t(u32(p))|uint64_t(u32(p+4))<<32;}
inline void put32(uint8_t*p,uint32_t n){for(int i=0;i<4;++i)p[i]=n>>(8*i);}
inline void put64(uint8_t*p,uint64_t n){put32(p,uint32_t(n));put32(p+4,uint32_t(n>>32));}
inline void init(uint8_t*p,Kind k,uint8_t tag){memset(p,0,SIGNED);memcpy(p,"B3F1",4);p[4]=1;p[5]=k;p[6]=tag;}
inline bool header(const uint8_t*p,size_t n){return (n==SIGNED||n==MACED)&&!memcmp(p,"B3F1",4)&&p[4]==1&&p[6]>=1&&p[6]<=2&&p[130]==0&&p[131]==0;}
inline bool bound(const uint8_t*a,const uint8_t*b){return !memcmp(a+8,b+8,98);}
inline bool intent(uint8_t k){return k==JOIN||k==LEAVE||k==BID||k==HELLO;}
inline bool newer(uint32_t a,uint32_t b){return a>b;} // Exhaustion closes session; never wrap counters.
struct Feedback {unsigned green=0,red=0,hz=0;};
inline Feedback feedback(uint8_t reason,uint32_t elapsed,bool paused=false){
 if(paused)return {0,elapsed%1000<100?26u:0u,0};
 if(reason==ACCEPTED)return elapsed<65?Feedback{38,0,2349}:Feedback{};
 return elapsed<240&&elapsed%80<40?Feedback{0,26,880}:Feedback{};
}
}
