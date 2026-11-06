#pragma once
// Portable 128x64 drawing engine, shared by firmware and host pixel preview.
#include <stdint.h>
#include <cstring>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
#include "Font5x7.h"
#include "Config.h"
struct TagView {
  bool seen=false,verified=false,valid=false,moving=false;
  bool buttonKnown=false,buttonHeld=false;uint32_t buttonCount=0;
  int rssi=-127; uint32_t lastRadio=0,lastProof=0,count=0;
  uint8_t history[20]={0};uint8_t historyCount=0;
};
struct View {
  bool sold=false;uint8_t winner=0;uint64_t hammerPrice=0;
  TagView tags[2];uint32_t proofs=0,errors=0,eventAt=0;uint8_t event=0,eventTag=0;
  char phase[22]="BOOTING",digest[17]="----------------"; bool fatal=false,radioReady=false;
};
struct Canvas {
  uint8_t pixels[1024];
  void clear(){memset(pixels,0,sizeof(pixels));}
  void pixel(int x,int y,bool on=true){if(x<0||x>=128||y<0||y>=64)return;
    if(on)pixels[x+(y/8)*128]|=1<<(y%8);else pixels[x+(y/8)*128]&=~(1<<(y%8));}
  void line(int x,int y,int xx,int yy){int dx=std::abs(xx-x),sx=x<xx?1:-1,dy=-std::abs(yy-y),sy=y<yy?1:-1,e=dx+dy;
    for(;;){pixel(x,y);if(x==xx&&y==yy)break;int e2=2*e;if(e2>=dy){e+=dy;x+=sx;}if(e2<=dx){e+=dx;y+=sy;}}}
  void rect(int x,int y,int w,int h){line(x,y,x+w-1,y);line(x,y+h-1,x+w-1,y+h-1);line(x,y,x,y+h-1);line(x+w-1,y,x+w-1,y+h-1);}
  void fill(int x,int y,int w,int h,bool on=true){for(int yy=std::max(y,0);yy<std::min(y+h,64);++yy)for(int xx=std::max(x,0);xx<std::min(x+w,128);++xx)pixel(xx,yy,on);}
  void circle(int x,int y,int r){for(int a=0;a<64;++a){float t=a*.09817477f;pixel(x+int(std::lround(r*std::cos(t))),y+int(std::lround(r*std::sin(t))));}}
  void text(int x,int y,const char *s,int scale=1){while(*s){unsigned ch=(unsigned char)*s++;if(ch<32||ch>126)ch='?';
    for(int col=0;col<5;++col){uint8_t bits=ascii5x7[(ch-32)*5+col];for(int row=0;row<7;++row)if(bits&(1<<row))fill(x+col*scale,y+row*scale,scale,scale);}
    x+=6*scale;}}
  void center(int y,const char *s,int scale=1){text((128-int(strlen(s))*6*scale+scale)/2,y,s,scale);}
};
inline bool fresh(const TagView&t,uint32_t now){return t.verified&&uint32_t(now-t.lastProof)<Config::FRESH_MS;}
// Canonical Ethereum facets for a rotating, thin 3D mark.
// Checker shading distinguishes facets on the monochrome OLED without distortion.
inline void facet(Canvas&c,int ax,int ay,int bx,int by,int cx,int cy,int shade){
  auto edge=[](int x1,int y1,int x2,int y2,int x,int y){return (x-x1)*(y2-y1)-(y-y1)*(x2-x1);};
  int area=edge(ax,ay,bx,by,cx,cy);if(!area)return;
  for(int y=std::max(0,std::min({ay,by,cy}));y<=std::min(63,std::max({ay,by,cy}));++y)
   for(int x=std::max(0,std::min({ax,bx,cx}));x<=std::min(127,std::max({ax,bx,cx}));++x){
    int e1=edge(ax,ay,bx,by,x,y),e2=edge(bx,by,cx,cy,x,y),e3=edge(cx,cy,ax,ay,x,y);
    if((e1>=0&&e2>=0&&e3>=0)||(e1<=0&&e2<=0&&e3<=0))
      c.pixel(x,y,shade==0||(shade==1?((x+y)&1)==0:(x%2==0&&y%2==0)));
   }
}
inline void diamond(Canvas &c,int cx,int cy,float angle,float size){
  // Extruded canonical Ethereum facets. Painter ordering hides rear surfaces;
  // perspective and a thin edge make a complete 360-degree turn recognizable.
  constexpr float v[9][2]={{0,-1},{-.614f,.019f},{0,-.260f},{.614f,.019f},{0,.382f},
                           {-.614f,.137f},{0,.501f},{.614f,.137f},{0,1}};
  constexpr uint8_t faces[6][3]={{0,1,2},{0,2,3},{1,2,4},{2,3,4},{5,6,8},{6,7,8}};
  constexpr uint8_t sides[8][2]={{0,1},{1,4},{4,3},{3,0},{5,6},{6,7},{7,8},{8,5}};
  struct Point{int x,y;float z;};Point p[18];float ca=std::cos(angle),sa=std::sin(angle);
  for(int side=0;side<2;++side)for(int i=0;i<9;++i){float z=side?-.09f:.09f;
   float rx=v[i][0]*ca+z*sa,rz=-v[i][0]*sa+z*ca,scale=3.8f/(3.8f-rz);
   p[i+side*9]={cx+int(std::lround(rx*size*scale)),cy+int(std::lround(v[i][1]*size*scale)),rz};}
  struct Triangle{uint8_t a,b,d,shade;float depth;};Triangle tris[28];int count=0;
  auto add=[&](int a,int b,int d,int shade){tris[count++]={uint8_t(a),uint8_t(b),uint8_t(d),uint8_t(shade),(p[a].z+p[b].z+p[d].z)/3};};
  for(int side=0;side<2;++side)for(int i=0;i<6;++i)add(faces[i][0]+side*9,faces[i][1]+side*9,faces[i][2]+side*9,i==1||i==5?0:i==2?2:1);
  for(auto&e:sides){add(e[0],e[1],e[0]+9,2);add(e[1],e[1]+9,e[0]+9,2);}
  std::sort(tris,tris+count,[](const Triangle&a,const Triangle&b){return a.depth<b.depth;});
  for(auto &tri:tris){auto&a=p[tri.a];auto&b=p[tri.b];auto&d=p[tri.d];
   facet(c,a.x,a.y,b.x,b.y,d.x,d.y,tri.shade);
   c.line(a.x,a.y,b.x,b.y);c.line(b.x,b.y,d.x,d.y);c.line(d.x,d.y,a.x,a.y);}
}
inline void bars(Canvas&c,int x,int y,int rssi){int n=rssi>-50?4:rssi>-65?3:rssi>-80?2:rssi>-100?1:0;
  for(int i=0;i<4;++i){c.rect(x+i*3,y-(i+1)*2,2,(i+1)*2);if(i<n)c.fill(x+i*3,y-(i+1)*2,2,(i+1)*2);}}
inline void drawVisual(Canvas&c,const View&v,uint32_t now,uint32_t sincePower,const char*location){
  c.clear();char b[40];float t=now*.001f;(void)location;
  if(v.fatal){c.center(4,"SYSTEM CHECK FAILED");diamond(c,64,31,t,15);c.center(55,"SEE SERIAL MONITOR");return;}
  if(sincePower<3800){
    for(int i=0;i<27;++i){int x=(i*37)%128,y=(int(now/30)+i*13)%64;c.pixel(x,y);if(i%3==0)c.pixel(x,y-1);}
    for(int i=0;i<5;++i){int y=45+int(std::fmod(t*12+i*5,20.f));c.line(0,y,127,y);}
    c.fill(48,3,33,39,false);diamond(c,64,21,t*1.1f,17);
    c.fill(0,40,128,10,false);c.center(41,"BID3");
    c.fill(0,52,128,12,false);c.center(53,v.radioReady?"RADIO READY":"INITIALIZING");c.fill(3,62,int(std::min(sincePower, uint32_t(3800))*122/3800),1);return;
  }
  if(v.sold){c.center(3,"BID3");c.center(17,"SOLD",2);snprintf(b,sizeof(b),"SEAT %u",v.winner);c.center(38,b);
    snprintf(b,sizeof(b),"%llu.%02llu",(unsigned long long)(v.hammerPrice/100),(unsigned long long)(v.hammerPrice%100));c.center(53,b);return;}
  if((v.event==3||v.event==4||v.event==5)&&uint32_t(now-v.eventAt)<2200){
    c.center(3,v.event==4?"BID ACCEPTED":v.event==5?"BID REFUSED":"BUTTON VERIFIED");snprintf(b,sizeof(b),"TAG%02u",v.eventTag);c.center(18,b,2);
    if(v.eventTag>=1&&v.eventTag<=2){const auto&q=v.tags[v.eventTag-1];
      snprintf(b,sizeof(b),"EVENT %lu",(unsigned long)q.buttonCount);c.center(41,b);
      c.center(55,v.event==3?"AUTHENTICATED INPUT":v.event==4?"ENGINE CONFIRMED":"NO BID ACCEPTED");}return;
  }
  if(v.event&&v.event!=3&&uint32_t(now-v.eventAt)<1400){
    bool ok=v.event==1;float elapsed=(now-v.eventAt)/1400.f;
    for(int r=0;r<3;++r)c.circle(22,31,4+int(std::fmod(elapsed*28+r*9,28.f)));
    diamond(c,22,31,t*2,12);c.text(51,12,ok?"TAG PROOF":"BID");
    snprintf(b,sizeof(b),"TAG%02u",v.eventTag);c.text(51,26,b,2);
    c.text(51,46,ok?"VERIFIED":"REJECTED");c.line(50,42,124,42);c.center(57,ok?"IDENTITY VERIFIED":"CHECK SERIAL LOG");return;
  }
  uint32_t scene=((sincePower-3800)/6000)%3;
  c.text(1,1,scene==0?"GATEWAY":"BID3 GW");c.text(94,1,"ROOM");c.line(0,10,127,10);
  if(scene==0){
    c.circle(31,35,22);c.circle(31,35,14);c.circle(31,35,6);c.line(7,35,55,35);c.line(31,12,31,57);
    float a=t*1.8f;for(int trail=0;trail<4;++trail)c.line(31,35,31+int(22*std::cos(a-trail*.10f)),35+int(22*std::sin(a-trail*.10f)));
    c.text(63,14,v.phase);
    for(int i=0;i<2;++i){const auto &q=v.tags[i];bool ok=fresh(q,now);int yy=27+i*15;
      snprintf(b,sizeof(b),"%02d %s",i+1,ok?"AUTH":q.seen&&now-q.lastRadio<10000?"SEEN":"SEEK");c.text(63,yy,b);
      if(q.seen&&now-q.lastRadio<10000){int x=i?42:19,y=i?44:25;c.circle(x,y,3);if(ok)c.fill(x-1,y-1,3,3);bars(c,112,yy+7,q.rssi);}}
    // The outer ring reaches y=57. Do not clear the old footer band here:
    // it erased the bottom arc even after the BID3 label was removed.
  }else if(scene==1){
    for(int i=0;i<2;++i){const auto&q=v.tags[i];int x=i*65;bool ok=fresh(q,now);
      snprintf(b,sizeof(b),"TAG%02d",i+1);c.text(x+2,14,b);c.text(x+2,25,ok?"VERIFIED":q.verified?"STALE":"WAITING");
      if(q.verified){snprintf(b,sizeof(b),"AGE %lus",(unsigned long)((now-q.lastProof)/1000));c.text(x+2,36,b);}
      if(q.buttonKnown){snprintf(b,sizeof(b),"PUSH %lu",(unsigned long)q.buttonCount);c.text(x+2,47,b);}
      else c.text(x+2,47,"PUSH --");
      if(q.historyCount>1)for(int j=1;j<q.historyCount;++j)c.line(x+2+(j-1)*3,62-q.history[j-1],x+2+j*3,62-q.history[j]);}
    c.line(63,12,63,62);
  }else{
    diamond(c,20,34,t*1.25f,17);c.text(46,14,"PROOF LEDGER");
    snprintf(b,sizeof(b),"SIGNED %lu",(unsigned long)v.proofs);c.text(46,26,b);
    snprintf(b,sizeof(b),"ERRORS %lu",(unsigned long)v.errors);c.text(46,38,b);
    c.fill(0,52,128,12,false);c.text(1,53,v.digest);int dot=int(now/100)%4;
    for(int i=0;i<4;++i)if(i==dot)c.fill(107+i*5,54,3,3);c.line(0,62,127,62);
  }
}
