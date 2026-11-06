#include "../Gateway/Visuals.h"
#include <fstream>
#include <string>
int main(int argc,char**argv){if(argc!=2)return 2;View v;Canvas c;v.radioReady=true;
 for(int scene=0;scene<5;++scene){v.sold=scene==4;v.winner=2;v.hammerPrice=11576;v.event=scene==2?3:scene==3?2:0;v.eventTag=1;v.eventAt=5000;v.tags[0].buttonCount=3;
  uint32_t now=scene?5100:1200;drawVisual(c,v,now,now,Config::DISPLAY_LOCATION);
  std::ofstream out(std::string(argv[1])+"/bid3_"+std::to_string(scene)+".pbm",std::ios::binary);out<<"P4\n128 64\n";
  for(int y=0;y<64;++y)for(int x=0;x<128;x+=8){uint8_t b=0;for(int k=0;k<8;++k)if(c.pixels[x+k+(y/8)*128]&(1<<(y%8)))b|=1<<(7-k);out.put(char(b));}
 }
}
