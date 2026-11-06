#pragma once
#include "FastCrypto.h"
#include "FastConfig.h"
#include <freertos/semphr.h>
#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>
#endif
namespace BagTrail {
constexpr char TRUSTED_GATEWAY[]="0483d5ecd955b31f12b84cf090b87ea2019122e2b2a257b2fc309cd36dab067fe1c93d5284b921dff24ca1aa739ea3182e35f1dbbb40aeff6de972465151fedfa2";
struct FastPacket{uint32_t generation=0;uint16_t n=0;uint8_t bytes[Fast::EVENT]={0};};
QueueHandle_t fastInputs=nullptr,fastControls=nullptr;SemaphoreHandle_t fastNotifyLock=nullptr;
BLECharacteristic*fastChar=nullptr;
std::atomic<bool> fastActive(false),fastKeyReady(false),fastAdmitted(false),fastResync(false);
std::atomic<uint32_t> fastVersion(Fast::MISSING),fastControlAt(0);
std::atomic<uint8_t> fastPhase(Fast::PAUSED);portMUX_TYPE fastLock=portMUX_INITIALIZER_UNLOCKED;
uint8_t fastShared[32]={0},fastKey[32]={0},fastNonce[32]={0};bool fastCapable=false;
uint32_t fastControlSeq=0,fastSequence=0;std::atomic<uint32_t> fastBeatSequence(0),fastInputSequence(0),fastParticipationEpoch(0);
FastPacket fastPending;bool fastWaiting=false;uint32_t fastWaitAt=0,fastSentAt=0;
void fastFail(){fastActive.store(false);fastKeyReady.store(false);fastAdmitted.store(false);}
bool fastSend(const uint8_t*p,size_t n){
 if(!fastChar||!connected.load()||xSemaphoreTake(fastNotifyLock,pdMS_TO_TICKS(5))!=pdTRUE)return false;
 fastChar->setValue(p,n);fastChar->notify();xSemaphoreGive(fastNotifyLock);return true;
}
void fastBody(uint8_t*p,const char*magic,uint8_t kind,uint32_t count,uint32_t at,uint32_t version){
 memset(p,0,Fast::EVENT);memcpy(p,magic,4);p[4]=1;p[5]=TAG;p[6]=kind;
 portENTER_CRITICAL(&fastLock);memcpy(p+8,fastNonce,32);portEXIT_CRITICAL(&fastLock);
 Fast::put32(p+44,version);Fast::put32(p+48,at);Fast::put32(p+52,count);memcpy(p+56,bootId,8);
}
void fastQueue(uint8_t kind,uint32_t count,uint32_t at,uint32_t version){
 if(!fastActive.load()||!fastInputs)return;FastPacket p;p.generation=fastParticipationEpoch.load();p.n=Fast::EVENT;fastBody(p.bytes,"B4E1",kind,count,at,kind==Fast::BID?version:Fast::MISSING);
 if(xQueueSend(fastInputs,&p,0)!=pdTRUE)fastFail();
}
// Runs in the button sampler, independently of ECDSA, sensor I/O and engine ACKs.
void fastInputReceipt(const ButtonInput::Snapshot&button,uint32_t now,bool enabled){
 static bool activeBefore=false,held=false;static uint32_t count=0,sentAt=0;static unsigned repeats=0;static FastPacket receipt;
 if(!enabled){activeBefore=false;repeats=0;return;}
 if(!activeBefore){activeBefore=true;count=button.count;held=button.pressed;return;}
 if(button.count!=count||button.pressed!=held){
  count=button.count;held=button.pressed;if(!count)return;
  uint32_t seq=++fastInputSequence;if(!seq){fastFail();return;}
  fastBody(receipt.bytes,"B5I1",Fast::PRESS,count,now,fastVersion.load());receipt.bytes[7]=held;Fast::put32(receipt.bytes+40,seq);
  uint8_t keyCopy[32];portENTER_CRITICAL(&fastLock);memcpy(keyCopy,fastKey,32);portEXIT_CRITICAL(&fastLock);
  if(!FastCrypto::mac(keyCopy,Fast::INPUT_DOMAIN,receipt.bytes,64))return;
  repeats=3;sentAt=now-20;
 }
 // Repeat identical bytes briefly to tolerate notification loss; receiver deduplicates.
 if(repeats&&uint32_t(now-sentAt)>=20){if(fastSend(receipt.bytes,Fast::INPUT_PACKET_SIZE))--repeats;sentAt=now;}
}
void fastSample(const ButtonInput::Snapshot&button,bool raw,uint32_t now){
 static bool lastRaw=false,wasActive=false,wasOn=true,switchRaw=true;static uint32_t switchAt=0;static uint32_t previousCount=0,lastBeat=0,edgeVersion=Fast::MISSING,edgeAt=0;static uint8_t edgePhase=Fast::PAUSED;static bool edgeAdmitted=false;
 bool on=digitalRead(SWITCH)==LOW,enabled=fastActive.load();if(on!=switchRaw){switchRaw=on;switchAt=now;}if(button.overflow){fastFail();return;}
 fastInputReceipt(button,now,enabled);
 if(raw!=lastRaw){lastRaw=raw;if(raw){edgeAt=now;edgeVersion=fastVersion.load();edgePhase=fastPhase.load();edgeAdmitted=fastAdmitted.load();}}
 if(enabled&&!wasActive){previousCount=button.count;wasOn=on;switchRaw=on;switchAt=now;fastQueue(on?Fast::JOIN:Fast::LEAVE,button.count,now,Fast::MISSING);}
 if(enabled&&on!=wasOn&&uint32_t(now-switchAt)>=50){wasOn=on;if(!on){fastAdmitted.store(false);fastParticipationEpoch.fetch_add(1);}lastBeat=now-250;fastQueue(on?Fast::JOIN:Fast::LEAVE,button.count,now,Fast::MISSING);}
 if(enabled&&fastResync.exchange(false))fastQueue(on?Fast::JOIN:Fast::LEAVE,button.count,now,Fast::MISSING);
 if(enabled&&button.count>previousCount&&on){bool bid=edgeAdmitted&&edgeVersion!=Fast::MISSING&&(edgePhase==Fast::OPEN||edgePhase==Fast::COUNTDOWN);if(bid)fastQueue(Fast::BID,button.count,edgeAt,edgeVersion);}
 previousCount=button.count;wasActive=enabled;
 if(enabled&&uint32_t(now-lastBeat)>=250){lastBeat=now;FastPacket p;fastBody(p.bytes,"B4H1",0,button.count,now,fastVersion.load());p.bytes[7]=wasOn;
  uint32_t seq=++fastBeatSequence;if(!seq){fastFail();return;}Fast::put32(p.bytes+40,seq);
  uint8_t keyCopy[32];portENTER_CRITICAL(&fastLock);memcpy(keyCopy,fastKey,32);portEXIT_CRITICAL(&fastLock);
  if(FastCrypto::mac(keyCopy,"Bid3.FastHeartbeat.v4",p.bytes,64))fastSend(p.bytes,Fast::HEARTBEAT);
 }
}
bool fastInit(){
 if(!BID3_ENABLE_FAST_CHANNEL)return false;
 fastInputs=xQueueCreate(12,sizeof(FastPacket));fastControls=xQueueCreate(12,sizeof(FastPacket));fastNotifyLock=xSemaphoreCreateMutex();
 uint8_t pub[65];for(unsigned i=0;i<65;++i){char s[3]={TRUSTED_GATEWAY[2*i],TRUSTED_GATEWAY[2*i+1],0};pub[i]=strtoul(s,nullptr,16);}
 fastCapable=fastInputs&&fastControls&&fastNotifyLock&&FastCrypto::shared(key,pub,drbg,fastShared);return fastCapable;
}
void fastPrepare(const uint8_t proof[199]){
 if(!fastCapable||fastActive.load())return;uint8_t derived[32];if(!FastCrypto::key(fastShared,proof,derived))return;
 fastActive.store(false);fastAdmitted.store(false);fastKeyReady.store(false);xQueueReset(fastInputs);xQueueReset(fastControls);
 portENTER_CRITICAL(&fastLock);memcpy(fastKey,derived,32);memcpy(fastNonce,proof+94,32);portEXIT_CRITICAL(&fastLock);
 fastControlSeq=0;fastSequence=0;fastBeatSequence.store(0);fastInputSequence.store(0);fastParticipationEpoch.store(0);fastWaiting=false;fastVersion.store(Fast::MISSING);fastPhase.store(Fast::PAUSED);fastKeyReady.store(true);
}
class FastControlCallbacks:public BLECharacteristicCallbacks{
 void onWrite(BLECharacteristic*c)override{String s=c->getValue();if(s.length()!=Fast::CONTROL||!fastControls)return;
  FastPacket p;p.generation=epoch.load();p.n=Fast::CONTROL;memcpy(p.bytes,s.c_str(),p.n);if(xQueueSend(fastControls,&p,0)!=pdTRUE)fastFail();}
};
void fastCreate(BLEService*service){
 fastChar=service->createCharacteristic(Fast::UUID,BLECharacteristic::PROPERTY_READ|BLECharacteristic::PROPERTY_NOTIFY);
 auto*control=service->createCharacteristic(Fast::CONTROL_UUID,BLECharacteristic::PROPERTY_WRITE);
 if(!fastChar||!control){fastCapable=false;return;}control->setCallbacks(new FastControlCallbacks());
#if defined(CONFIG_BLUEDROID_ENABLED)
 fastChar->addDescriptor(new BLE2902());
#endif
 const uint8_t version[4]={'B','5','F','1'};fastChar->setValue(version,sizeof(version));
}
void fastTick(){
 if(!fastCapable)return;
 if(!connected.load()){fastFail();fastWaiting=false;return;}
 FastPacket p;while(xQueueReceive(fastControls,&p,0)==pdTRUE){const uint8_t*b=p.bytes;
  if(p.generation!=epoch.load()||!fastKeyReady.load()||memcmp(b,"B4C1",4)||b[4]!=1||b[5]!=TAG||b[6]<Fast::INIT||b[6]>Fast::RESYNC||memcmp(b+8,fastNonce,32)||Fast::get32(b+40)<=fastControlSeq||!FastCrypto::check(fastKey,"Bid3.FastControl.v4",b,72))continue;
  fastControlSeq=Fast::get32(b+40);fastControlAt.store(millis());fastPhase.store(b[52]);fastVersion.store(b[55]?Fast::get32(b+44):Fast::MISSING);
  if(!fastActive.exchange(true))Serial.println("BID3_FAST_LINK=READY; baseline proof + authenticated session verified");
  if(b[6]==Fast::RESYNC){fastAdmitted.store(false);fastResync.store(true);}
  if(b[6]==Fast::ACK&&fastWaiting&&Fast::get32(b+48)==Fast::get32(fastPending.bytes+40)){
   if(fastPending.bytes[6]==Fast::BID)Serial.printf("BID3_LATENCY_JSON={\"tag\":%u,\"seq\":%lu,\"result\":%u,\"edge_to_tag_ack_ms\":%lu}\n",TAG,(unsigned long)Fast::get32(b+48),b[53],(unsigned long)uint32_t(millis()-Fast::get32(fastPending.bytes+48)));
   if(fastPending.bytes[6]==Fast::JOIN)fastAdmitted.store(b[53]==Fast::ACCEPTED&&fastPending.generation==fastParticipationEpoch.load()&&digitalRead(SWITCH)==LOW);
   if(fastPending.bytes[6]==Fast::LEAVE)fastAdmitted.store(false);fastWaiting=false;
  }
 }
 uint32_t now=millis();if(fastActive.load()&&uint32_t(now-fastControlAt.load())>2500){fastFail();server->disconnect(server->getConnId());return;}
 if(!fastActive.load())return;
 if(!fastWaiting&&xQueueReceive(fastInputs,&p,0)==pdTRUE){
  if(memcmp(p.bytes+8,fastNonce,32))return;
  if((p.bytes[6]==Fast::BID||p.bytes[6]==Fast::JOIN)&&(p.generation!=fastParticipationEpoch.load()||digitalRead(SWITCH)!=LOW))return; // OFF drops unsent participation work before allocating a sequence.
  if(fastSequence==UINT32_MAX){fastFail();return;}Fast::put32(p.bytes+40,fastSequence+1);
  uint32_t start=micros();if(!FastCrypto::sign(key,drbg,p.bytes)){fastFail();return;}uint32_t signUs=micros()-start;
  if((p.bytes[6]==Fast::BID||p.bytes[6]==Fast::JOIN)&&(p.generation!=fastParticipationEpoch.load()||digitalRead(SWITCH)!=LOW))return;
  if(!FastCrypto::mac(fastKey,"Bid3.FastEvent.v4",p.bytes,128)){fastFail();return;}
  ++fastSequence;fastPending=p;fastWaiting=true;fastWaitAt=millis();fastSentAt=fastWaitAt;fastSend(p.bytes,Fast::EVENT);
  Serial.printf("BID3_FAST_SIGN_US=%lu kind=%s\n",(unsigned long)signUs,Fast::kindName(p.bytes[6]));
 }
 now=millis();if(fastWaiting&&uint32_t(now-fastSentAt)>=400){fastSentAt=now;fastSend(fastPending.bytes,Fast::EVENT);}
 if(fastWaiting&&uint32_t(now-fastWaitAt)>3000){fastFail();server->disconnect(server->getConnId());}
}
}
