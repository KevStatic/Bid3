#pragma once
#include <stdint.h>
#include <stddef.h>
#include <vector>
struct Transmission{uint8_t address;std::vector<uint8_t> data;};
struct FakeWire{
 bool beginOK=true,powered=true,failSend=false;uint8_t ackAddress=0x3C,current=0;
 unsigned beginCount=0,endCount=0,timeout=0;std::vector<uint8_t> data;std::vector<Transmission> sent;
 bool begin(unsigned,unsigned,unsigned){++beginCount;return beginOK;}
 bool end(){++endCount;return true;}
 void setTimeOut(unsigned t){timeout=t;}
 void beginTransmission(uint8_t a){current=a;data.clear();}
 size_t write(uint8_t v){data.push_back(v);return 1;}
 size_t write(const uint8_t*p,size_t n){data.insert(data.end(),p,p+n);return n;}
 unsigned endTransmission(){sent.push_back({current,data});if(!powered||current!=ackAddress||(!data.empty()&&failSend))return 4;return 0;}
};
inline FakeWire Wire;
