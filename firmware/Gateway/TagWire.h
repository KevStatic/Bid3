#pragma once
#include <stdint.h>
#include <stddef.h>
#include <cstring>
namespace TagWire {
inline uint16_t u16(const uint8_t*p){return p[0]|uint16_t(p[1])<<8;}
inline uint32_t u32(const uint8_t*p){return p[0]|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline bool fieldsMatch(const uint8_t*p,size_t n,int tag,const uint8_t device[6],const uint8_t request[84],bool pending,uint32_t age){
 if(!pending||age>5000||tag<0||tag>1||n!=190||memcmp(p,"BTAG",4)||p[4]!=1||p[5]!=tag+1||(p[6]&~7)||p[7]||!u32(p+22)||memcmp(p+8,device,6)||memcmp(p+46,request+4,80))return false;
 bool valid=p[6]&1;if(valid){if(u16(p+30)>1000)return false;for(int i=0;i<7;++i)if(u16(p+32+2*i)==0x8000)return false;}
 else{if(u16(p+30)!=65535||(p[6]&2))return false;for(int i=0;i<7;++i)if(u16(p+32+2*i)!=0x8000)return false;}
 return true;
}
}
