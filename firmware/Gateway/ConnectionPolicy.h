#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace Bid3 {
// Advertising data is a discovery hint only. Pinned enrollment and signed
// session messages still authenticate the peer after GATT connects.
inline int discoveryTag(const uint8_t*data,size_t length,const char*name){
 if(data&&length==6&&data[0]==0xff&&data[1]==0xff&&data[2]=='B'&&
    ((data[3]=='3'&&data[4]==2)||(data[3]=='T'&&data[4]==1))&&data[5]>=1&&data[5]<=2)return data[5]-1;
 if(name&&!strcmp(name,"Bid3-Tag01"))return 0;
 if(name&&!strcmp(name,"Bid3-Tag02"))return 1;
 return -1;
}
enum LinkAction:uint8_t {CONNECT_LINK,WAIT_FOR_ENGINE,ARM_SESSION,KEEP_SESSION};
inline LinkAction linkAction(bool connected,bool linked,bool ready,bool armed,bool locked,bool trusted){
 if(!connected||!linked)return CONNECT_LINK;
 if(ready)return KEEP_SESSION;
 return armed&&!locked&&trusted?ARM_SESSION:WAIT_FOR_ENGINE;
}
inline bool tagLed(bool switchOn){return switchOn;}
}
