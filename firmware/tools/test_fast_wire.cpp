#include "../shared/FastWire.h"
#include <cassert>
#include <iostream>
int main(){unsigned checks=0;uint8_t p[Fast::EVENT]={0},nonce[32],boot[8];for(int i=0;i<32;++i)nonce[i]=i;for(int i=0;i<8;++i)boot[i]=0xa0+i;
 memcpy(p,"B4E1",4);p[4]=1;p[5]=1;memcpy(p+8,nonce,32);memcpy(p+56,boot,8);Fast::put32(p+40,17);Fast::put32(p+44,42);
 char text[180];for(uint8_t kind=1;kind<=4;++kind){p[6]=kind;assert(Fast::message(p,text,sizeof(text)));std::cout<<text<<"\n";++checks;assert(Fast::eventFields(p,sizeof(p),1,nonce,boot));++checks;}
 for(unsigned i=8;i<40;++i){p[i]^=1;assert(!Fast::eventFields(p,sizeof(p),1,nonce,boot));p[i]^=1;++checks;}
 for(unsigned i=56;i<64;++i){p[i]^=1;assert(!Fast::eventFields(p,sizeof(p),1,nonce,boot));p[i]^=1;++checks;}
 p[6]=Fast::BID;Fast::put32(p+44,Fast::MISSING);assert(!Fast::message(p,text,sizeof(text)));++checks;
 Fast::put32(p+44,42);assert(!Fast::message(p,text,5));++checks;
 std::cout<<checks<<" fast-frame checks passed\n";
}
