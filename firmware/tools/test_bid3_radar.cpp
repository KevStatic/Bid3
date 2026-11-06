#include "../Gateway/Visuals.h"
#include <cassert>
#include <iostream>
int main(){View view;view.radioReady=true;Canvas radar,expected,boot,brand;unsigned checks=0;
 drawVisual(radar,view,5100,5100,"BID3");expected.clear();expected.text(1,1,"GATEWAY");expected.text(94,1,"ROOM");
 for(int y=0;y<9;++y)for(int x=0;x<128;++x){unsigned bit=1u<<(y%8);assert((radar.pixels[x+(y/8)*128]&bit)==(expected.pixels[x+(y/8)*128]&bit));++checks;}
 for(int y=58;y<64;++y)for(int x=0;x<128;++x){assert(!(radar.pixels[x+(y/8)*128]&(1u<<(y%8))));++checks;}
 // Every outer-ring dot must survive all later drawing, including the bottom
 // dot at (31,57), while the sweep animates through multiple revolutions.
 for(unsigned frame=0;frame<100;++frame){
  uint32_t now=4000+frame*50;drawVisual(radar,view,now,now,"BID3");
  for(unsigned dot=0;dot<64;++dot){float angle=dot*.09817477f;
   int x=31+int(std::lround(22*std::cos(angle))),y=35+int(std::lround(22*std::sin(angle)));
   assert(radar.pixels[x+(y/8)*128]&(1u<<(y%8)));++checks;
  }
 }
 drawVisual(boot,view,1200,1200,"BID3");brand.clear();brand.center(41,"BID3");
 for(int y=41;y<48;++y)for(int x=0;x<128;++x){unsigned bit=1u<<(y%8);assert((boot.pixels[x+(y/8)*128]&bit)==(brand.pixels[x+(y/8)*128]&bit));++checks;}
 std::cout<<checks<<" radar/startup branding checks passed\n";
}
