#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <driver/gpio.h>
#include "Visuals.h"
#include "Config.h"
class Oled {
 bool begun=false,transferring=false,visible=false;uint8_t page=0;uint8_t frame[1024];
 bool candidate=false;uint32_t stableAt=0,lastProbe=0,lastRecover=0;
 bool send(uint8_t control,const uint8_t*bytes,size_t n){
  Wire.beginTransmission(address);Wire.write(control);Wire.write(bytes,n);return Wire.endTransmission()==0;
 }
 bool configure(){
  // Keep display OFF until the first fresh framebuffer has reached all 8 pages.
  const uint8_t common[]={0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0x00,0x40,0xA1,0xC8,0xDA,0x12,0x81,0x70,0xA4,0xA6};
  const uint8_t sh[]={0xAD,0x8B,0xD9,0x22,0xDB,0x35};
  const uint8_t ssd[]={0x8D,0x14,0xD9,0xF1,0xDB,0x40,0x20,0x02};
  return send(0,common,sizeof(common))&&(sh1106?send(0,sh,sizeof(sh)):send(0,ssd,sizeof(ssd)));
 }
public:
 bool ready=false,sh1106=Config::DEFAULT_SH1106;uint8_t address=0;Canvas screen;
 uint32_t recoveries=0,frames=0;
 bool begin(){begun=Wire.begin(Config::SDA_PIN,Config::SCL_PIN,Config::I2C_HZ);
  gpio_pullup_dis(GPIO_NUM_21);gpio_pulldown_dis(GPIO_NUM_21);gpio_pullup_dis(GPIO_NUM_22);gpio_pulldown_dis(GPIO_NUM_22);
  if(begun)Wire.setTimeOut(12);return begun;}
 bool ping(uint8_t a){Wire.beginTransmission(a);return Wire.endTransmission()==0;}
 void reset(){ready=false;candidate=false;transferring=false;visible=false;address=0;}
 // Call repeatedly from the UI task. Stable ACKs allow switched power to settle.
 bool probe(uint32_t now){
  if(ready||uint32_t(now-lastProbe)<80)return false;lastProbe=now;
  if(!begun&&!begin())return false;
  uint8_t found=ping(0x3C)?0x3C:ping(0x3D)?0x3D:0;
  if(!found){candidate=false;
   if(uint32_t(now-lastRecover)>=1000){lastRecover=now;Wire.end();begun=false;begin();++recoveries;}return false;}
  if(!candidate||address!=found){candidate=true;stableAt=now;address=found;return false;}
  if(uint32_t(now-stableAt)<180)return false;
  if(!configure()){reset();return false;}ready=true;visible=false;transferring=false;return true;
 }
 bool canQueue()const{return ready&&!transferring;}
 void queueFrame(){if(!canQueue())return;memcpy(frame,screen.pixels,1024);page=0;transferring=true;}
 // One page per pass: no full-screen blocking flush in the animation/audio loop.
 bool service(){if(!ready||!transferring)return true;
  uint8_t cursor[]={uint8_t(0xB0|page),uint8_t(sh1106?2:0),0x10};
  bool ok=send(0,cursor,3);
  for(unsigned x=0;ok&&x<128;x+=32)ok=send(0x40,frame+page*128+x,32);
  if(!ok){reset();return false;}
  if(++page==8){transferring=false;++frames;if(!visible){uint8_t on=0xAF;if(!send(0,&on,1)){reset();return false;}visible=true;}}
  return true;
 }
};
