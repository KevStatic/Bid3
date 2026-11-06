#include "../Gateway/Visuals.h"
#include <fstream>
#include <string>
int main(int argc,char**argv){
 if(argc!=2)return 2;View v;Canvas c;v.radioReady=true;
 for(unsigned frame=0;frame<240;++frame){uint32_t now=frame*100;
  if(now>4000){for(int i=0;i<2;++i){auto&t=v.tags[i];t.seen=true;t.verified=true;t.valid=true;t.moving=i==0;t.lastRadio=now;t.lastProof=now-1000;t.rssi=i?-72:-55;t.count=12+i;
   t.historyCount=20;for(int j=0;j<20;++j)t.history[j]=i?2:((j*7)%9);}v.proofs=25;strcpy(v.phase,"SCAN");strcpy(v.digest,"9a41d83ba6c1e028");}
  v.event=0;
  if(now>=7000&&now<8400){v.event=1;v.eventAt=7000;v.eventTag=1;}
  if(now>=11000&&now<12400){v.event=2;v.eventAt=11000;v.eventTag=2;v.errors=1;}
  drawVisual(c,v,now,now,"BID3");
  char name[32];snprintf(name,sizeof(name),"/frame_%03u.pbm",frame);std::ofstream out(std::string(argv[1])+name,std::ios::binary);out<<"P4\n128 64\n";
  for(int y=0;y<64;++y)for(int x=0;x<128;x+=8){uint8_t b=0;for(int k=0;k<8;++k)if(c.pixels[(x+k)+(y/8)*128]&(1<<(y%8)))b|=1<<(7-k);out.put(char(b));}
 }
}
