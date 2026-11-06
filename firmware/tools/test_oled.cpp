#include "../Gateway/Oled.h"
#include <cassert>
#include <cstdio>
unsigned count=0;
#define CHECK(x) do{assert(x);++count;}while(0)
bool sentOn(){for(auto&t:Wire.sent)if(t.data.size()==2&&t.data[0]==0&&t.data[1]==0xAF)return true;return false;}
int main(){
 Oled o;CHECK(o.begin());CHECK(Wire.timeout==12);CHECK(!o.ready);CHECK(!o.probe(80));CHECK(!o.probe(160));CHECK(!o.probe(240));CHECK(o.probe(320));CHECK(o.ready);CHECK(!sentOn());
 o.screen.clear();o.screen.pixel(0,0);o.queueFrame();CHECK(!o.canQueue());o.screen.clear(); // queued frame is an immutable snapshot
 size_t before=Wire.sent.size();CHECK(o.service());CHECK(Wire.sent.size()-before==5);CHECK(Wire.sent[before+1].data[1]==1);CHECK(!sentOn());
 for(int i=0;i<7;++i)CHECK(o.service());CHECK(sentOn());CHECK(o.frames==1);CHECK(o.canQueue());
 Wire.powered=false;o.queueFrame();CHECK(!o.service());CHECK(!o.ready);CHECK(!o.canQueue());CHECK(!o.probe(400));
 Wire.powered=true;CHECK(!o.probe(480));CHECK(!o.probe(560));CHECK(!o.probe(640));CHECK(o.probe(720));CHECK(o.ready);
 Wire.sent.clear();o.queueFrame();for(int i=0;i<8;++i)CHECK(o.service());CHECK(o.frames==2);CHECK(sentOn());
 o.reset();Wire.powered=false;CHECK(!o.probe(1100));CHECK(Wire.endCount>=1);CHECK(o.recoveries>=1);CHECK(Wire.timeout==12);
 Wire.powered=true;Wire.ackAddress=0x3D;o.sh1106=false;CHECK(!o.probe(1200));CHECK(!o.probe(1280));CHECK(!o.probe(1360));CHECK(o.probe(1440));CHECK(o.address==0x3D);
 o.queueFrame();Wire.failSend=true;CHECK(!o.service());CHECK(!o.ready);Wire.failSend=false;
 // Bounce during the 180 ms settling period must restart that timer.
 CHECK(!o.probe(1520));Wire.powered=false;CHECK(!o.probe(1600));Wire.powered=true;CHECK(!o.probe(1680));CHECK(!o.probe(1760));CHECK(!o.probe(1840));CHECK(o.probe(1920));
 printf("OLED switch/recovery: %u checks passed (mock I2C)\n",count);
}
