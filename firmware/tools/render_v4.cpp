#include "../Gateway/Visuals.h"
#include <fstream>
#include <string>
int main(int argc,char**argv){if(argc!=2)return 2;View view;view.radioReady=true;Canvas c;
 auto save=[&](const char*name,uint32_t now,uint32_t power){drawVisual(c,view,now,power,"BID3");
  std::ofstream out(std::string(argv[1])+"/"+name+".pbm",std::ios::binary);out<<"P4\n128 64\n";
  for(int y=0;y<64;++y)for(int x=0;x<128;x+=8){uint8_t b=0;for(int k=0;k<8;++k)if(c.pixels[(x+k)+(y/8)*128]&(1<<(y%8)))b|=1<<(7-k);out.put(char(b));}
 };
 save("startup",1200,1200);save("radar",5100,5100);
 for(auto&t:view.tags){t.verified=t.valid=t.seen=t.buttonKnown=true;t.lastRadio=t.lastProof=8000;t.buttonCount=7;}
 view.eventTag=1;view.eventAt=8000;view.event=4;save("accepted",8000,8000);
 view.event=5;save("refused",8000,8000);view.event=0;view.sold=true;view.winner=1;view.hammerPrice=11025;save("sold",8000,8000);
}
