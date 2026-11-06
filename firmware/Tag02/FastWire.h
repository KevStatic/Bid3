#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
namespace Fast {
constexpr char UUID[]="b7610006-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char CONTROL_UUID[]="b7610007-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr size_t BODY=64,EVENT=144,HEARTBEAT=80,CONTROL=88;
constexpr uint32_t MISSING=UINT32_MAX;
enum Kind:uint8_t{JOIN=1,LEAVE=2,BID=3,PRESS=4};
enum Command:uint8_t{INIT=1,STATE=2,ACK=3,RESYNC=4};
enum Phase:uint8_t{PAUSED=0,LOBBY=1,OPEN=2,COUNTDOWN=3,CLOSED=4};
enum Result:uint8_t{RECEIVED=0,ACCEPTED=1,REFUSED=2};
inline uint32_t get32(const uint8_t*p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline void put32(uint8_t*p,uint32_t v){for(int i=0;i<4;++i)p[i]=v>>(8*i);}
inline void put64(uint8_t*p,uint64_t v){put32(p,uint32_t(v));put32(p+4,uint32_t(v>>32));}
inline void hex(const uint8_t*p,size_t n,char*out){const char*h="0123456789abcdef";for(size_t i=0;i<n;++i){out[2*i]=h[p[i]>>4];out[2*i+1]=h[p[i]&15];}out[2*n]=0;}
inline const char*kindName(uint8_t k){return k==JOIN?"JOIN":k==LEAVE?"LEAVE":k==BID?"BID":k==PRESS?"PRESS":"INVALID";}
inline void session(const uint8_t boot[8],const uint8_t nonce[32],char out[82]){hex(boot,8,out);out[16]='-';hex(nonce,32,out+17);}
inline bool message(const uint8_t*event,char*out,size_t size){
 if(event[5]<1||event[5]>2||event[6]<JOIN||event[6]>PRESS)return false;
 char sid[82],version[12]="";session(event+56,event+8,sid);
 if(event[6]==BID){if(get32(event+44)==MISSING)return false;snprintf(version,sizeof(version),"%lu",(unsigned long)get32(event+44));}
 int n=snprintf(out,size,"Bid3.Intent.v1|TAG%u|%s|%lu|%s|%s",event[5],sid,(unsigned long)get32(event+40),kindName(event[6]),version);
 return n>0&&size_t(n)<size;
}
inline bool eventFields(const uint8_t*p,size_t n,uint8_t tag,const uint8_t nonce[32],const uint8_t boot[8]){
 return n==EVENT&&!memcmp(p,"B4E1",4)&&p[4]==1&&p[5]==tag&&p[6]>=JOIN&&p[6]<=PRESS&&!p[7]&&get32(p+40)&&!memcmp(p+8,nonce,32)&&!memcmp(p+56,boot,8);
}
// UI-only input receipt: authenticated by the existing session, never a BID.
constexpr size_t INPUT_PACKET_SIZE=80;
constexpr char INPUT_DOMAIN[]="Bid3.ButtonInput.v5";
inline bool inputFields(const uint8_t*p,size_t n,uint8_t tag,const uint8_t nonce[32],const uint8_t boot[8]){
 return n==INPUT_PACKET_SIZE&&!memcmp(p,"B5I1",4)&&p[4]==1&&p[5]==tag&&p[6]==PRESS&&p[7]<=1&&get32(p+40)&&get32(p+52)&&!memcmp(p+8,nonce,32)&&!memcmp(p+56,boot,8);
}

struct InputWindow {
 uint32_t seq=0,count=0;
 bool eligible(const uint8_t*p)const{return get32(p+40)>seq&&get32(p+52)>=count;}
 void commit(const uint8_t*p){seq=get32(p+40);count=get32(p+52);}
};

}
