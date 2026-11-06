#pragma once
#include "Crypto.h"
#include "ButtonWire.h"

namespace ButtonSecurity {
constexpr char TAG_DOMAIN[]="BagTrail.ButtonProof.v1";
constexpr char SCAN_DOMAIN[]="BagTrail.GatewayButtonScan.v1";
inline bool makeChallenge(uint8_t request[84]){
  if(!Security::makeChallenge(request))return false;
  memcpy(request,"BTB1",4);return true;
}
inline bool verifyProof(const uint8_t*p,size_t n,int tag,const uint8_t request[84],bool&pending,uint32_t age,uint8_t digest[32]){
  if(tag<0||tag>1||!ButtonWire::fieldsMatch(p,n,tag,Security::tags[tag].device,request,pending,age))return false;
  if(!Security::taggedHash(TAG_DOMAIN,p,ButtonWire::BODY,digest)||
     !Security::verifySignature(Security::tags[tag].key,digest,p+ButtonWire::BODY))return false;
  pending=false;return true;
}
inline bool scanEnvelope(const uint8_t proof[ButtonWire::PROOF],int rssi,uint32_t observed,uint8_t out[ButtonWire::SCAN],uint8_t digest[32]){
  if(Security::sequence==UINT32_MAX||rssi< -127||rssi>=0)return false;
  memset(out,0,ButtonWire::SCAN);memcpy(out,"BGB1",4);out[4]=1;out[5]=proof[5];out[6]=proof[6];
  memcpy(out+8,Security::gateway,16);memcpy(out+24,Security::checkpoint,32);memcpy(out+56,Security::boot,8);
  Security::put32(out+64,++Security::sequence);Security::put32(out+68,observed);Security::put16(out+72,uint16_t(int16_t(rssi)));
  memcpy(out+74,proof,ButtonWire::PROOF);
  return Security::taggedHash(SCAN_DOMAIN,out,ButtonWire::SCAN_BODY,digest)&&Security::sign(digest,out+ButtonWire::SCAN_BODY);
}
}
