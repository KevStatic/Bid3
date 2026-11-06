#pragma once
#include "TagWire.h"

namespace ButtonWire {
constexpr size_t BODY=135, PROOF=199, SCAN_BODY=273, SCAN=337;
inline bool fieldsMatch(const uint8_t*p,size_t n,int tag,const uint8_t device[6],
                        const uint8_t request[84],bool pending,uint32_t age){
  if(n!=PROOF||memcmp(p,"BTP1",4)||memcmp(request,"BTB1",4)||p[134]>1)return false;
  // Share the exact legacy identity/context/sensor validation without changing v1.
  uint8_t legacy[190]={0};memcpy(legacy,p,126);memcpy(legacy,"BTAG",4);
  if(!TagWire::fieldsMatch(legacy,sizeof(legacy),tag,device,request,pending,age))return false;
  return TagWire::u32(p+126)!=0||TagWire::u32(p+130)==0;
}
}
