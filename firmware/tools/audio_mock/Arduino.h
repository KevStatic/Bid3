#pragma once
#include <stdint.h>
#include <vector>
#include <cstdarg>
#define INPUT 0
#define OUTPUT 1
#define LOW 0
#define HIGH 1
struct Call {int op,pin,value;};
inline std::vector<Call> calls;
inline bool attachOK=true,toneOK=true;
inline void pinMode(unsigned pin,int mode){calls.push_back({0,int(pin),mode});}
inline void digitalWrite(unsigned pin,int value){calls.push_back({1,int(pin),value});}
inline bool ledcWrite(unsigned pin,unsigned duty){calls.push_back({2,int(pin),int(duty)});return true;}
inline bool ledcDetach(unsigned pin){calls.push_back({3,int(pin),0});return true;}
inline bool ledcAttachChannel(unsigned pin,unsigned,unsigned,unsigned channel){calls.push_back({4,int(pin),int(channel)});return attachOK;}
inline unsigned ledcWriteTone(unsigned pin,unsigned freq){calls.push_back({5,int(pin),int(freq)});return toneOK?freq:0;}
struct FakeSerial {void println(const char*){} void printf(const char*,...){};};
inline FakeSerial Serial;
