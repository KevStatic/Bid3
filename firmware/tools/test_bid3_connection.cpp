#include "../shared/ConnectionPolicy.h"
#include <cassert>
#include <iostream>
int main(){using namespace Bid3;unsigned checks=0;
 const uint8_t primary1[]={0xff,0xff,'B','3',2,1},primary2[]={0xff,0xff,'B','3',2,2};
 assert(discoveryTag(primary1,6,nullptr)==0);assert(discoveryTag(primary2,6,nullptr)==1);checks+=2;
 assert(discoveryTag(nullptr,0,"Bid3-Tag01")==0);assert(discoveryTag(nullptr,0,"Bid3-Tag02")==1);checks+=2;
 assert(discoveryTag(nullptr,0,nullptr)==-1);++checks;
 for(size_t n=0;n<6;++n){assert(discoveryTag(primary1,n,nullptr)==-1);++checks;}
 for(int i=0;i<6;++i){uint8_t p[6];memcpy(p,primary1,6);p[i]^=0x80;assert(discoveryTag(p,6,nullptr)==-1);++checks;}
 const uint8_t legacy[]={0xff,0xff,'B','T',1,2};assert(discoveryTag(legacy,6,nullptr)==1);++checks;
 // Link acquisition never depends on ARM, price, trust provisioning or locked state.
 for(int armed=0;armed<2;++armed)for(int locked=0;locked<2;++locked)for(int trust=0;trust<2;++trust){
  assert(linkAction(false,false,false,armed,locked,trust)==CONNECT_LINK);++checks;
 }
 assert(linkAction(true,true,false,false,false,false)==WAIT_FOR_ENGINE);++checks;
 assert(linkAction(true,true,false,true,false,false)==WAIT_FOR_ENGINE);++checks;
 assert(linkAction(true,true,false,true,false,true)==ARM_SESSION);++checks;
 assert(linkAction(true,true,true,true,false,true)==KEEP_SESSION);++checks;
 assert(linkAction(true,true,false,true,true,true)==WAIT_FOR_ENGINE);++checks;
 // No phase/timer/bid input can blink the tag indicator: only the switch matters.
 for(unsigned i=0;i<10000;++i){assert(tagLed(true));assert(!tagLed(false));checks+=2;}
 std::cout<<checks<<" discovery/connection/static-LED checks passed\n";
}
