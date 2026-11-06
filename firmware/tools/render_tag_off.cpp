#include "../Gateway/Visuals.h"
#include <fstream>
#include <string>
int main(int argc,char**argv){if(argc!=2)return 2;View v;v.radioReady=true;std::strcpy(v.phase,"OPEN");Canvas c;
 auto save=[&](const char*name,uint32_t now){drawVisual(c,v,now,now,"BID3");std::ofstream out(std::string(argv[1])+"/"+name+".pbm",std::ios::binary);out<<"P4\n128 64\n";
  for(int y=0;y<64;++y)for(int x=0;x<128;x+=8){uint8_t b=0;for(int k=0;k<8;++k)if(c.pixels[(x+k)+(y/8)*128]&(1<<(y%8)))b|=1<<(7-k);out.put(char(b));}
 };
 for(auto&t:v.tags){t.seen=t.verified=t.valid=true;t.lastRadio=t.lastProof=5000;}
 applyAvailability(v,0,true,true,true,5000);applyAvailability(v,1,true,true,true,5000);
 applyAvailability(v,0,true,true,false,5100);save("switch-off",5100);
 applyAvailability(v,1,true,true,false,5101);v.event=0;save("both-off",7000);
 applyAvailability(v,0,true,true,true,7001);applyAvailability(v,1,true,true,true,7001);
 applyAvailability(v,0,false,true,true,7100);save("tag-lost",7100);v.event=0;save("one-lost",8700);
}
