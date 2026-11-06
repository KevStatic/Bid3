#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEClient.h>
#include <BLEAdvertisedDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <atomic>
#include "Oled.h"
#include "Crypto.h"
#include "VerifierSelfTest.h"
#include "AuctionWire.h"
#include "AuctionCrypto.h"
#include "Sounds.h"
#include "ConnectionPolicy.h"
#include <esp_gattc_api.h>
#if !defined(CONFIG_IDF_TARGET_ESP32) || !defined(CONFIG_BLUEDROID_ENABLED)
#error "Use ESP32 Dev Module with bundled Bluedroid, ESP32 core 3.3.12."
#endif
namespace GatewayApp {
struct Packet {uint8_t tag=0;uint16_t n=0;uint32_t generation=0,rx=0;uint8_t bytes[Bid3::SIGNED]={0};};
struct Candidate{uint8_t address[6]={0},type=0;bool seen=false;int rssi=-127;uint32_t at=0;};
struct Seat {
 BLEClient*client=nullptr;BLERemoteCharacteristic*control=nullptr;BLERemoteCharacteristic*events=nullptr;
 std::atomic<bool> linked{false},trustMatches{false};std::atomic<uint16_t> negotiatedMtu{0};uint8_t tagBoot[8]={0};
 std::atomic<bool> ready{false},active{false},authenticated{false};std::atomic<uint32_t> generation{1},beatAt{0};
 uint8_t context[Bid3::SIGNED]={0},secret[32]={0};uint32_t controlSeq=1,eventSeq=0,beatSeq=0,pendingSeq=0;
 uint32_t pressCount=0;bool pending=false,haveAck=false;uint8_t lastEvent[Bid3::SIGNED]={0};uint8_t lastAck[Bid3::SIGNED]={0};
 QueueHandle_t tx=nullptr;SemaphoreHandle_t stateLock=nullptr,ioLock=nullptr;
};
struct StateGuard{SemaphoreHandle_t m;explicit StateGuard(SemaphoreHandle_t x):m(x){xSemaphoreTakeRecursive(m,portMAX_DELAY);}~StateGuard(){xSemaphoreGiveRecursive(m);}};
struct IoGuard{SemaphoreHandle_t m;explicit IoGuard(SemaphoreHandle_t x):m(x){xSemaphoreTake(m,portMAX_DELAY);}~IoGuard(){xSemaphoreGive(m);}};
Seat seats[2];Candidate candidates[2];portMUX_TYPE candidateLock=portMUX_INITIALIZER_UNLOCKED;
QueueHandle_t rx=nullptr,commands=nullptr,uiEvents=nullptr,feedbackQueue=nullptr;
struct Command {char line[420];};
struct UiEvent{uint8_t tag,kind;uint32_t count;uint64_t price=0;uint8_t digest[8]={0};};
struct Effect{uint8_t reason;bool sold;};
struct Round{uint8_t auction[32]={0},rules[32]={0};uint32_t epoch=0,version=0;uint64_t nextPrice=0;uint8_t phase=Bid3::PAUSED,leader=0;bool armed=false;};
Round roundState;portMUX_TYPE roundLock=portMUX_INITIALIZER_UNLOCKED;
std::atomic<bool> fatal(false),peripheral(false),paused(true),activeModule(false),activeLow(false);
std::atomic<uint32_t> bridgeAt(0),feedbackDropped(0);std::atomic<bool> rxOverflow(false);std::atomic<bool> radioReady(false),toggleDisplay(false);
Oled oled;View view;BLEScan*scanner=nullptr;
uint32_t powerAt=0,lastFrame=0,ingressSeq=0;
std::atomic<uint32_t> setupHandle(UINT32_MAX),setupAt(0);std::atomic<bool> setupClosing(false);
char serialLine[420];size_t serialUsed=0;bool serialOverflow=false;
Round roundCopy(){portENTER_CRITICAL(&roundLock);Round r=roundState;portEXIT_CRITICAL(&roundLock);return r;}
void roundStore(const Round&r){portENTER_CRITICAL(&roundLock);roundState=r;portEXIT_CRITICAL(&roundLock);paused.store(r.phase==Bid3::PAUSED);}
void reportFault(const char*why,int tag=0){
 portENTER_CRITICAL(&roundLock);if(roundState.armed&&roundState.phase!=Bid3::LOCKED){roundState.phase=Bid3::PAUSED;paused.store(true);}portEXIT_CRITICAL(&roundLock);
 Serial.printf("BID3_HEALTH_JSON={\"schema\":\"bid3.health.v1\",\"health\":\"down\",\"tag\":%d,\"reason\":\"%s\"}\n",tag,why);
}
void effect(uint8_t reason,bool sold=false){Effect e{reason,sold};if(xQueueSend(feedbackQueue,&e,0)!=pdTRUE){++feedbackDropped;reportFault("feedback_queue_full");}}
void feedbackTask(void*){
 bool attached=ledcAttachChannel(Config::BUZZER_PIN,2000,10,8);int oldHz=-1;
 if(!attached){fatal.store(true);reportFault("buzzer_pwm_failed");}
 uint32_t at=millis();uint8_t reason=Bid3::INVALID;bool have=false,sold=false,poweredBefore=false;Audio::Player startup;
 for(;;){bool powered=peripheral.load();bool newEffect=false;Effect e;if(xQueueReceive(feedbackQueue,&e,0)==pdTRUE){at=millis();reason=e.reason;sold=e.sold;have=true;newEffect=true;startup.stop();}
  if(powered&&!poweredBefore&&!newEffect&&(!have||uint32_t(millis()-at)>500))startup.request(Audio::STARTUP);poweredBefore=powered;
  uint32_t now=millis(),age=now-at;startup.tick(now);bool startupPlaying=startup.busy();auto f=have?Bid3::feedback(reason,age):Bid3::Feedback{};
  if(sold&&age<480){bool on=age%160<100;f={on?38u:0u,0,on?2637u:0u};}
  if(paused.load()&&(!have||age>=300))f=Bid3::feedback(0,now,true);
  if(startupPlaying){unsigned hz=startup.hz;f={hz?Config::GREEN_DUTY_MAX:0u,0,hz};}
  if(!powered){
   startup.stop();
   ledcWrite(Config::GREEN_PIN,0);ledcWrite(Config::RED_PIN,0);
   if(attached){ledcWrite(Config::BUZZER_PIN,0);ledcDetach(Config::BUZZER_PIN);attached=false;}
   pinMode(Config::BUZZER_PIN,INPUT);oldHz=-1;vTaskDelay(pdMS_TO_TICKS(1));continue;
  }
  if(fatal.load()&&peripheral.load())f={0,26,0};
  // One timeline drives all three outputs. OLED and BLE never own these pins.
  ledcWrite(Config::GREEN_PIN,f.green);ledcWrite(Config::RED_PIN,f.red);
  if(int(f.hz)!=oldHz){
   if(activeModule.load()){if(attached){ledcWrite(Config::BUZZER_PIN,0);ledcDetach(Config::BUZZER_PIN);attached=false;}
    pinMode(Config::BUZZER_PIN,OUTPUT);digitalWrite(Config::BUZZER_PIN,(f.hz>0)^activeLow.load()?HIGH:LOW);
   }else{
    if(!attached)attached=ledcAttachChannel(Config::BUZZER_PIN,2000,10,8);
    if(attached){if(f.hz)ledcWriteTone(Config::BUZZER_PIN,f.hz);else ledcWrite(Config::BUZZER_PIN,0);}
   }oldHz=f.hz;
  }
  vTaskDelay(pdMS_TO_TICKS(1));
 }
}
class Discoveries:public BLEAdvertisedDeviceCallbacks{
 void onResult(BLEAdvertisedDevice d)override{
  String marker=d.haveManufacturerData()?d.getManufacturerData():String();String name=d.haveName()?d.getName():String();
  int tag=Bid3::discoveryTag(reinterpret_cast<const uint8_t*>(marker.c_str()),marker.length(),name.c_str());if(tag<0)return;
  Candidate c;c.seen=true;c.type=d.getAddressType();c.rssi=d.getRSSI();c.at=millis();memcpy(c.address,d.getAddress().getNative(),6);
  portENTER_CRITICAL(&candidateLock);candidates[tag]=c;portEXIT_CRITICAL(&candidateLock);
 }
} discoveries;
void scanEnded(BLEScanResults){}
void notifyFor(int tag,uint8_t*data,size_t n){
 if((n!=Bid3::SIGNED&&n!=Bid3::MACED)||!seats[tag].ready.load())return;
 Packet p;p.tag=tag;p.n=n;p.generation=seats[tag].generation.load();p.rx=micros();memcpy(p.bytes,data,n);
 if(xQueueSend(rx,&p,0)!=pdTRUE)rxOverflow.store(true);
}
void notify0(BLERemoteCharacteristic*,uint8_t*d,size_t n,bool){notifyFor(0,d,n);}
void notify1(BLERemoteCharacteristic*,uint8_t*d,size_t n,bool){notifyFor(1,d,n);}
class ClientCallbacks:public BLEClientCallbacks{
 int tag;
 public:explicit ClientCallbacks(int t):tag(t){}
 void onConnect(BLEClient*)override{}
 void onDisconnect(BLEClient*)override{seats[tag].linked.store(false);seats[tag].ready.store(false);seats[tag].authenticated.store(false);++seats[tag].generation;}
};
void txTask(void*arg){int tag=int(intptr_t(arg));Packet p;
 for(;;){if(xQueueReceive(seats[tag].tx,&p,pdMS_TO_TICKS(20))!=pdTRUE)continue;
  auto&s=seats[tag];IoGuard io(s.ioLock);if(!s.ready.load()||p.generation!=s.generation.load())continue;
  if(!s.control||!s.control->writeValue(p.bytes,p.n,true)){s.ready.store(false);reportFault("control_write_failed",tag+1);}
 }
}
bool control(int tag,Bid3::Kind kind,uint8_t reason=0,uint32_t ref=0){
 auto&s=seats[tag];StateGuard state(s.stateLock);if(!s.ready.load())return false;Round r=roundCopy();
 Packet p;p.tag=tag;p.n=Bid3::MACED;p.generation=s.generation.load();memcpy(p.bytes,s.context,Bid3::BODY);
 p.bytes[5]=kind;p.bytes[7]=reason;
 if(s.controlSeq==UINT32_MAX){reportFault("control_sequence_exhausted",tag+1);return false;}
 Bid3::put32(p.bytes+106,r.version);Bid3::put32(p.bytes+110,++s.controlSeq);Bid3::put64(p.bytes+114,r.nextPrice);
 Bid3::put32(p.bytes+122,ref);memset(p.bytes+126,0,6);p.bytes[126]=r.phase;p.bytes[127]=r.leader;
 if(!Bid3Crypto::mac(s.secret,p.bytes,"Bid3.Control.v1"))return false;
 if(kind==Bid3::ACK){memcpy(s.lastAck,p.bytes,Bid3::MACED);s.haveAck=true;}
 if(xQueueSend(s.tx,&p,0)!=pdTRUE){reportFault("control_queue_full",tag+1);return false;}return true;
}
void linkMessage(int tag,const char*state,const char*detail){
 Serial.printf("BID3_LINK_JSON={\"schema\":\"bid3.link.v2\",\"tag\":%d,\"state\":\"%s\",\"detail\":\"%s\"}\n",tag+1,state,detail);
}
// The installed library returns from setMTU before negotiation is complete.
// Observe the actual CFG_MTU event instead of trusting its optimistic cache.
void gattEvents(esp_gattc_cb_event_t event,esp_gatt_if_t interface,esp_ble_gattc_cb_param_t*param){
 if(event!=ESP_GATTC_CFG_MTU_EVT)return;
 for(auto&s:seats)if(s.client&&s.client->getGattcIf()==interface&&s.client->getConnId()==param->cfg_mtu.conn_id)
  s.negotiatedMtu.store(param->cfg_mtu.status==ESP_GATT_OK?param->cfg_mtu.mtu:23);
}
struct SetupGuard{
 explicit SetupGuard(BLEClient*client){setupClosing.store(false);setupAt.store(millis());setupHandle.store((uint32_t(client->getGattcIf())<<16)|client->getConnId());}
 ~SetupGuard(){setupHandle.store(UINT32_MAX);}
};
void checkSetupDeadline(){
 uint32_t h=setupHandle.load();if(h!=UINT32_MAX&&uint32_t(millis()-setupAt.load())>=10000&&!setupClosing.exchange(true)){
  esp_ble_gattc_close(esp_gatt_if_t(h>>16),uint16_t(h));Serial.println("BID3_LINK_ERROR=GATT_SETUP_TIMEOUT");
 }
}
bool prepareLink(int tag){
 auto&s=seats[tag];Candidate c;portENTER_CRITICAL(&candidateLock);c=candidates[tag];portEXIT_CRITICAL(&candidateLock);
 if(!c.seen)return false;
 linkMessage(tag,"CONNECTING","BLE transport; engine ARM not required");s.negotiatedMtu.store(0);
 auto*client=s.client;
 if(client->isConnected()){
  client->disconnect();uint32_t at=millis();while(client->isConnected()&&uint32_t(millis()-at)<1500)vTaskDelay(pdMS_TO_TICKS(5));
  if(client->isConnected()){linkMessage(tag,"RETRY","disconnect_pending");return false;}
 }
 if(!client->connect(BLEAddress(c.address,c.type),c.type,2500)){linkMessage(tag,"RETRY","connect_failed");return false;}
 SetupGuard deadline(client);
 auto fail=[&](const char*why){s.linked.store(false);s.ready.store(false);linkMessage(tag,"REJECTED",why);if(client->isConnected())client->disconnect();return false;};
 uint32_t at=millis();while(client->isConnected()&&!s.negotiatedMtu.load()&&uint32_t(millis()-at)<350)vTaskDelay(pdMS_TO_TICKS(5));
 if(!s.negotiatedMtu.load())client->setMTU(247);
 at=millis();while(client->isConnected()&&!s.negotiatedMtu.load()&&uint32_t(millis()-at)<1500)vTaskDelay(pdMS_TO_TICKS(5));
 if(!client->isConnected()||s.negotiatedMtu.load()<Bid3::SIGNED+3)return fail("mtu_below_199_or_no_negotiation_event");
 client->updateConnParams(6,12,0,200);
 client->getServices(); // Re-discover after reconnect; SDK retains its old service cache.
 auto*service=client->getService(Bid3::SERVICE);if(!service)return fail("service_missing_upload_matching_tags");
 auto*info=service->getCharacteristic(Bid3::INFO);auto*ctl=service->getCharacteristic(Bid3::CONTROL);auto*evt=service->getCharacteristic(Bid3::EVENTS);
 if(!info||!ctl||!evt||!info->canRead()||!ctl->canWrite()||!evt->canNotify())return fail("characteristics_missing_upload_matching_tags");
 String id=info->readValue();auto*b=reinterpret_cast<const uint8_t*>(id.c_str());
 if((id.length()!=84&&id.length()!=116)||memcmp(b,"B3I1",4)||b[4]!=tag+1)return fail("invalid_tag_info");
 if(memcmp(b+5,Security::tags[tag].device,6)||memcmp(b+11,Security::tags[tag].pub,65))return fail("tag_identity_differs_from_enrollment");
 bool trustMatches=id.length()==84||!memcmp(b+84,Security::fingerprint,32);
 {StateGuard state(s.stateLock);memcpy(s.tagBoot,b+76,8);s.control=ctl;s.events=evt;s.authenticated.store(false);s.trustMatches.store(trustMatches);s.beatAt.store(millis());}
 evt->registerForNotify(tag==0?notify0:notify1);
 if(!client->isConnected())return fail("disconnected_during_discovery");
 s.linked.store(true);linkMessage(tag,"CONNECTED",trustMatches?"BLE ready; waiting for engine ARM":"BLE ready; gateway public key needs enrollment on this tag");
 return true;
}
bool armSession(int tag,const Round&r){
 auto&s=seats[tag];if(!s.client->isConnected()||!s.linked.load()||!s.trustMatches.load())return false;
 uint8_t arm[Bid3::SIGNED];Bid3::init(arm,Bid3::ARM,tag+1);memcpy(arm+8,Security::tags[tag].device,6);memcpy(arm+14,s.tagBoot,8);
 if(mbedtls_ctr_drbg_random(&Security::rng,arm+22,16))return false;
 memcpy(arm+38,r.auction,32);memcpy(arm+70,r.rules,32);Bid3::put32(arm+102,r.epoch);Bid3::put32(arm+106,r.version);Bid3::put32(arm+110,1);Bid3::put64(arm+114,r.nextPrice);arm[126]=r.phase;arm[127]=r.leader;
 uint8_t secret[32];if(!Bid3Crypto::sign(Security::own,Security::rng,arm,"Bid3.Arm.v1")||!Bid3Crypto::sessionKey(Security::own,Security::tags[tag].key,Security::rng,arm,secret))return false;
 {StateGuard state(s.stateLock);memcpy(s.secret,secret,32);memcpy(s.context,arm,sizeof(arm));s.controlSeq=1;s.eventSeq=0;s.beatSeq=0;s.authenticated.store(false);s.pending=false;s.haveAck=false;s.pendingSeq=0;xQueueReset(s.tx);s.beatAt.store(millis());}
 // Allow an immediate response once ARM is delivered. TX is serialized by ioLock.
 s.ready.store(true);SetupGuard deadline(s.client);
 if(!s.control->writeValue(arm,sizeof(arm),true)){s.ready.store(false);linkMessage(tag,"RETRY","arm_write_failed");return false;}
 Serial.printf("BID3_SESSION_JSON={\"schema\":\"bid3.session.v1\",\"tag\":%d,\"session\":\"%s\",\"tag_boot\":\"%s\",\"auction_hash\":\"%s\",\"epoch\":%lu}\n",tag+1,Security::hex(arm+22,16).c_str(),Security::hex(arm+14,8).c_str(),Security::hex(arm+38,32).c_str(),(unsigned long)r.epoch);
 return true;
}
void connectionTask(void*){
 Serial.println("BID3_BOOT=loading_identity_and_verifier");
 if(!Security::init()||!externalVerifierSelfTest()){fatal.store(true);Serial.println("BID3_FATAL=CRYPTO_INITIALIZATION");return;}
 Security::printPublic();Serial.println("BID3_V2: scanning/connect runs before engine ARM. If needed, enroll this gateway key on both tags.");
 BLEDevice::init("Bid3-Gateway");BLEDevice::setMTU(247);BLEDevice::setCustomGattcHandler(gattEvents);scanner=BLEDevice::getScan();
 if(!scanner){fatal.store(true);return;}
 scanner->setActiveScan(true);scanner->setInterval(80);scanner->setWindow(60);scanner->setAdvertisedDeviceCallbacks(&discoveries,true);
 for(int i=0;i<2;++i){seats[i].client=BLEDevice::createClient();if(!seats[i].client){fatal.store(true);return;}seats[i].client->setClientCallbacks(new ClientCallbacks(i));}
 radioReady.store(true);uint32_t attempts[2]={0,0},scanReportAt=0;bool reported[2]={false,false},hadSession[2]={false,false};
 for(;;){
  Round r=roundCopy();bool scanNeeded=!seats[0].linked.load()||!seats[1].linked.load();
  if(scanNeeded&&!scanner->isScanning()&&!scanner->start(0,scanEnded,false))Serial.println("BID3_SCAN_RETRY=start_failed");
  for(int tag=0;tag<2;++tag){auto&s=seats[tag];
   Candidate c;portENTER_CRITICAL(&candidateLock);c=candidates[tag];portEXIT_CRITICAL(&candidateLock);
   if(c.seen&&!reported[tag]){reported[tag]=true;linkMessage(tag,"DISCOVERED","advertisement found");}
   if(hadSession[tag]&&!s.ready.load()){reportFault("session_lost",tag+1);hadSession[tag]=false;}
   auto action=Bid3::linkAction(s.client->isConnected(),s.linked.load(),s.ready.load(),r.armed,r.phase==Bid3::LOCKED,s.trustMatches.load());
   if(action==Bid3::WAIT_FOR_ENGINE||action==Bid3::KEEP_SESSION)continue;
   if(uint32_t(millis()-attempts[tag])<1000)continue;attempts[tag]=millis();IoGuard io(s.ioLock);
   if(action==Bid3::CONNECT_LINK){s.ready.store(false);if(!prepareLink(tag))continue;}
   r=roundCopy();
   if(Bid3::linkAction(s.client->isConnected(),s.linked.load(),s.ready.load(),r.armed,r.phase==Bid3::LOCKED,s.trustMatches.load())==Bid3::ARM_SESSION){
    if(armSession(tag,r))hadSession[tag]=true;
    else {s.ready.store(false);s.linked.store(false);if(s.client->isConnected())s.client->disconnect();}
   }
  }
  if(uint32_t(millis()-scanReportAt)>=5000){scanReportAt=millis();Serial.printf("BID3_SCAN_STATUS scanning=%u tag1=%s tag2=%s engine=%s\n",scanner->isScanning(),seats[0].linked.load()?"CONNECTED":reported[0]?"SEEN":"SEARCHING",seats[1].linked.load()?"CONNECTED":reported[1]?"SEEN":"SEARCHING",r.armed?"ARMED":"WAIT_ARM");}
  if(seats[0].linked.load()&&seats[1].linked.load()&&scanner->isScanning())scanner->stop();
  vTaskDelay(pdMS_TO_TICKS(20));
 }
}
bool freshHardware(){
 if(uint32_t(millis()-bridgeAt.load())>1000)return false;
 for(auto&s:seats)if(!s.ready.load()||!s.authenticated.load()||uint32_t(millis()-s.beatAt.load())>1200)return false;
 return true;
}
bool integer(const char*s,uint64_t&n,uint64_t limit){if(!s||!*s)return false;n=0;for(;*s;++s){if(*s<'0'||*s>'9')return false;unsigned d=*s-'0';if(n>limit/10||(n==limit/10&&d>limit%10))return false;n=n*10+d;}return true;}
void handleCommand(char*line){
 char*args[14];int count=0;char*save=nullptr;for(char*t=strtok_r(line," ",&save);t&&count<14;t=strtok_r(nullptr," ",&save))args[count++]=t;
 if(count<2||strcmp(args[0],"BID3"))return;
 if(count==2&&!strcmp(args[1],"PING")){bridgeAt.store(millis());return;}
 Round r=roundCopy();uint64_t values[10]={0};
 auto number=[&](int index,uint64_t max,uint64_t&out){return index<count&&integer(args[index],out,max);};
 if(!strcmp(args[1],"ARM")&&count==9){
  if(!Security::unhex(args[2],r.auction,32)||!number(3,UINT32_MAX,values[0])||!Security::unhex(args[4],r.rules,32)||!number(5,UINT32_MAX,values[1])||!number(6,9007199254740991ULL,values[2])||!number(7,Bid3::LOCKED,values[3])||!number(8,2,values[4]))return;
  Round old=roundCopy();if(old.armed){Serial.println("BID3_COMMAND_ERROR=already_armed; restart gateway only under engine recovery");return;}
  r.epoch=values[0];r.version=values[1];r.nextPrice=values[2];r.phase=values[3];r.leader=values[4];r.armed=true;bridgeAt.store(millis());roundStore(r);return;
 }
 if(!r.armed)return;
 if(count==2&&(!strcmp(args[1],"PAUSE")||!strcmp(args[1],"CLOSE"))){
  bool close=!strcmp(args[1],"CLOSE");r.phase=close?Bid3::LOCKED:Bid3::PAUSED;roundStore(r);
  for(int tag=0;tag<2;++tag)control(tag,close?Bid3::CLOSE:Bid3::PAUSE);
  // CLOSE alone never signals a sale. RESULT is required to bind the winner.
  return;
 }
 if(!strcmp(args[1],"RESULT")&&count==6){
  if(r.phase==Bid3::LOCKED||!number(2,2,values[0])||!values[0]||!number(3,9007199254740991ULL,values[1])||!number(4,UINT32_MAX,values[2])||!number(5,UINT32_MAX,values[3]))return;
  if(r.leader!=values[0])return; // RESULT reports an already committed engine result; it never awards locally.
  r.phase=Bid3::LOCKED;roundStore(r);effect(Bid3::ACCEPTED,true);UiEvent resultEvent{r.leader,4,0,values[1]};xQueueSend(uiEvents,&resultEvent,0);
  for(int tag=0;tag<2;++tag)control(tag,Bid3::CLOSE);
  Serial.printf("BID3_RESULT_ACK_JSON={\"schema\":\"bid3.result_ack.v1\",\"winner_tag\":%u,\"price_minor\":%llu,\"final_seq\":%llu,\"countdown_generation\":%llu}\n",r.leader,(unsigned long long)values[1],(unsigned long long)values[2],(unsigned long long)values[3]);return;
 }
 if(!strcmp(args[1],"STATE")&&count==6){
  if(!number(2,UINT32_MAX,values[0])||!number(3,9007199254740991ULL,values[1])||!number(4,Bid3::LOCKED,values[2])||!number(5,2,values[3])||values[0]<r.version||r.phase==Bid3::LOCKED)return;
  if(r.phase==Bid3::PAUSED&&values[2]!=Bid3::PAUSED&&!freshHardware())return;
  r.version=values[0];r.nextPrice=values[1];r.phase=values[2];r.leader=values[3];bridgeAt.store(millis());roundStore(r);
  for(int tag=0;tag<2;++tag)control(tag,r.phase==Bid3::PAUSED?Bid3::PAUSE:Bid3::QUOTE);return;
 }
 if(!strcmp(args[1],"DECIDE")&&count==12){
  uint8_t session[16];
  if(!number(2,2,values[0])||!values[0]||!Security::unhex(args[3],session,16)||!number(4,UINT32_MAX,values[1])||!number(5,Bid3::INVALID,values[2])||!number(6,UINT32_MAX,values[3])||!number(7,UINT32_MAX,values[4])||!number(8,9007199254740991ULL,values[5])||!number(9,Bid3::LOCKED,values[6])||!number(10,2,values[7])||strcmp(args[11],"END"))return;
  int tag=int(values[0])-1;auto&s=seats[tag];
  if(!s.ready.load()||!s.pending||s.pendingSeq!=values[1]||memcmp(session,s.context+22,16)||values[4]<r.version||r.phase==Bid3::LOCKED)return;
  if(values[2]==Bid3::ACCEPTED&&uint32_t(millis()-bridgeAt.load())>1000)return;
  uint8_t nextPhase=values[6];if(r.phase==Bid3::PAUSED&&nextPhase!=Bid3::LOCKED)nextPhase=Bid3::PAUSED;
  r.version=values[4];r.nextPrice=values[5];r.phase=nextPhase;r.leader=values[7];roundStore(r);bridgeAt.store(millis());
  // Event kind is retained in context[5] only until decision; session bindings do not include it.
  uint8_t kind=s.context[5];if(values[2]==Bid3::ACCEPTED){if(kind==Bid3::JOIN)s.active.store(true);if(kind==Bid3::LEAVE)s.active.store(false);}
  s.pending=false;control(tag,Bid3::ACK,values[2],values[1]);
  for(int other=0;other<2;++other)if(other!=tag)control(other,Bid3::QUOTE);
  if(kind==Bid3::BID){effect(values[2]);UiEvent e{uint8_t(tag+1),uint8_t(values[2]==0?3:2),s.pressCount};xQueueSend(uiEvents,&e,0);}return;
 }
 Serial.println("BID3_COMMAND_ERROR=invalid_command");
}
void auctionTask(void*){
 uint32_t lastControl=0,lastHealth=0;bool bridgeFault=false;
 for(;;){if(rxOverflow.exchange(false))reportFault("radio_event_queue_full");Command cmd;for(int i=0;i<6&&xQueueReceive(commands,&cmd,0)==pdTRUE;++i)handleCommand(cmd.line);
  Packet p;for(int i=0;i<8&&xQueueReceive(rx,&p,0)==pdTRUE;++i){
   auto&s=seats[p.tag];StateGuard state(s.stateLock);if(!s.ready.load()||p.generation!=s.generation.load()||!Bid3::header(p.bytes,p.n)||p.bytes[6]!=p.tag+1||!Bid3::bound(p.bytes,s.context))continue;
   uint32_t seq=Bid3::u32(p.bytes+110);
   if(p.n==Bid3::MACED&&p.bytes[5]==Bid3::HEARTBEAT){
    if(seq>s.beatSeq&&Bid3Crypto::checkMac(s.secret,p.bytes,"Bid3.Liveness.v1")){s.beatSeq=seq;s.authenticated.store(true);s.beatAt.store(millis());}continue;
   }
   if(p.n!=Bid3::SIGNED||!Bid3::intent(p.bytes[5])||seq<s.eventSeq||!seq)continue;
   if(seq==s.eventSeq){
    if(!memcmp(p.bytes,s.lastEvent,Bid3::SIGNED)&&s.haveAck&&Bid3::u32(s.lastAck+122)==seq)control(p.tag,Bid3::ACK,s.lastAck[7],seq);
    continue;
   }
   uint32_t began=micros();if(!Bid3Crypto::verify(Security::tags[p.tag].key,p.bytes,"Bid3.Intent.v1"))continue;
   uint32_t verifyUs=micros()-began;s.authenticated.store(true);s.beatAt.store(millis());
   if(seq==s.eventSeq){if(s.haveAck&&Bid3::u32(s.lastAck+122)==seq)control(p.tag,Bid3::ACK,s.lastAck[7],seq);continue;}
   if(s.pending||seq!=s.eventSeq+1){reportFault("intent_sequence_gap",p.tag+1);continue;}
   memcpy(s.lastEvent,p.bytes,Bid3::SIGNED);s.eventSeq=seq;s.pending=true;s.pendingSeq=seq;s.context[5]=p.bytes[5];s.pressCount=Bid3::u32(p.bytes+122);s.haveAck=false;
   UiEvent verified{uint8_t(p.tag+1),1,s.pressCount};uint8_t digest[32];if(Security::hash(p.bytes,p.n,digest))memcpy(verified.digest,digest,8);xQueueSend(uiEvents,&verified,0);
   Serial.printf("BID3_EVENT_JSON={\"schema\":\"bid3.intent.v1\",\"tag\":%u,\"gateway_boot\":\"%s\",\"rx_order\":%lu,\"received_us\":%lu,\"verify_us\":%lu,\"intent_hex\":\"%s\"}\n",p.tag+1,Security::hex(Security::boot,8).c_str(),(unsigned long)++ingressSeq,(unsigned long)p.rx,(unsigned long)verifyUs,Security::hex(p.bytes,p.n).c_str());
  }
  uint32_t now=millis();Round r=roundCopy();
  if(r.armed&&r.phase!=Bid3::LOCKED){
   if(uint32_t(now-bridgeAt.load())>1000){if(!bridgeFault){reportFault("bridge_heartbeat_lost");bridgeFault=true;}}else bridgeFault=false;
   for(int tag=0;tag<2;++tag)if(seats[tag].ready.load()&&uint32_t(now-seats[tag].beatAt.load())>(seats[tag].authenticated.load()?1200u:8000u)){seats[tag].ready.store(false);seats[tag].linked.store(false);if(seats[tag].client->isConnected())seats[tag].client->disconnect();reportFault("tag_auth_or_liveness_lost_check_gateway_key",tag+1);}
  }
  if(uint32_t(now-lastControl)>=250){lastControl=now;for(int tag=0;tag<2;++tag)control(tag,paused.load()?Bid3::PAUSE:Bid3::QUOTE);}
  if(uint32_t(now-lastHealth)>=500){lastHealth=now;Serial.printf("BID3_HEALTH_JSON={\"schema\":\"bid3.health.v1\",\"gateway\":\"%s\",\"tag1\":\"%s\",\"tag2\":\"%s\",\"phase\":%u}\n",fatal.load()?"down":"ok",(seats[0].ready.load()&&seats[0].authenticated.load())?"ok":"unknown",(seats[1].ready.load()&&seats[1].authenticated.load())?"ok":"unknown",roundCopy().phase);}
  vTaskDelay(pdMS_TO_TICKS(1));
 }
}
void serialTask(void*){uint32_t publicAt=0;for(;;){
 if(radioReady.load()&&!roundCopy().armed&&uint32_t(millis()-publicAt)>=5000){publicAt=millis();Security::printPublic();}
 for(int i=0;i<128&&Serial.available();++i){char c=Serial.read();if(c=='\r')continue;
  if(serialUsed==0&&!serialOverflow&&c=='p'){if(radioReady.load())Security::printPublic();else Serial.println("BID3_STATUS=identity_initializing; wait for public key output");continue;}
  if(c!='\n'){if(serialUsed+1<sizeof(serialLine)&&!serialOverflow)serialLine[serialUsed++]=c;else serialOverflow=true;continue;}
  serialLine[serialUsed]=0;
  if(!serialOverflow){
   if(!strcmp(serialLine,"p")){if(radioReady.load())Security::printPublic();}
   else if(!strcmp(serialLine,"d"))toggleDisplay.store(true);
   else {Command command{};memcpy(command.line,serialLine,serialUsed+1);if(xQueueSend(commands,&command,0)!=pdTRUE)reportFault("serial_command_queue_full");}
  }else reportFault("serial_line_too_long");serialUsed=0;serialOverflow=false;
 }
 vTaskDelay(pdMS_TO_TICKS(1));
}}
void setupGateway(){
 Serial.setTxBufferSize(8192);Serial.begin(Config::SERIAL_BAUD);
 pinMode(Config::GREEN_PIN,OUTPUT);pinMode(Config::RED_PIN,OUTPUT);digitalWrite(Config::GREEN_PIN,LOW);digitalWrite(Config::RED_PIN,LOW);
 if(!ledcAttachChannel(Config::GREEN_PIN,5000,8,0)||!ledcAttachChannel(Config::RED_PIN,5000,8,1))fatal.store(true);
 rx=xQueueCreate(32,sizeof(Packet));commands=xQueueCreate(16,sizeof(Command));uiEvents=xQueueCreate(16,sizeof(UiEvent));feedbackQueue=xQueueCreate(8,sizeof(Effect));
 for(auto&s:seats){s.tx=xQueueCreate(12,sizeof(Packet));s.stateLock=xSemaphoreCreateRecursiveMutex();s.ioLock=xSemaphoreCreateMutex();}
 if(!rx||!commands||!uiEvents||!feedbackQueue||!seats[0].tx||!seats[1].tx||!seats[0].stateLock||!seats[1].stateLock||!seats[0].ioLock||!seats[1].ioLock){fatal.store(true);return;}
 oled.begin();Preferences p;if(p.begin("bt-ui",true)){oled.sh1106=p.getBool("sh1106",Config::DEFAULT_SH1106);activeModule.store(p.getBool("activeBuzzer",Config::DEFAULT_ACTIVE_BUZZER));activeLow.store(p.getBool("activeLow",Config::DEFAULT_ACTIVE_LOW));p.end();}
 Serial.println("Bid3 gateway V2 / immediate BLE connection / signed individual BID intents / authoritative engine ACK required / hammer 10000 ms.");
 Serial.println("Existing NVS identity and wiring retained. d=OLED driver with newline; p=public key immediately. BID3 commands require newline.");
 TaskHandle_t task=nullptr;
 if(xTaskCreatePinnedToCore(feedbackTask,"bid3-feedback",4096,nullptr,3,&task,1)!=pdPASS||
    xTaskCreatePinnedToCore(connectionTask,"bid3-connect",12288,nullptr,1,&task,0)!=pdPASS||
    xTaskCreatePinnedToCore(auctionTask,"bid3-auction",12288,nullptr,2,&task,1)!=pdPASS||
    xTaskCreatePinnedToCore(serialTask,"bid3-serial",4096,nullptr,2,&task,0)!=pdPASS)fatal.store(true);
 for(int tag=0;tag<2;++tag)if(xTaskCreatePinnedToCore(txTask,tag?"bid3-tx2":"bid3-tx1",4096,reinterpret_cast<void*>(intptr_t(tag)),1,&task,0)!=pdPASS)fatal.store(true);
}
void loopGateway(){
 if(!uiEvents){delay(10);return;}
 uint32_t now=millis();checkSetupDeadline();view.radioReady=radioReady.load();view.fatal=fatal.load();
 if(oled.probe(now)){powerAt=now;peripheral.store(true);}
 UiEvent e;while(xQueueReceive(uiEvents,&e,0)==pdTRUE){if(e.kind==1){++view.proofs;if(e.tag>=1&&e.tag<=2)++view.tags[e.tag-1].count;String digest=Security::hex(e.digest,8);snprintf(view.digest,sizeof(view.digest),"%s",digest.c_str());continue;}if(e.kind==4){view.sold=true;view.winner=e.tag;view.hammerPrice=e.price;continue;}view.event=e.kind;view.eventTag=e.tag;view.eventAt=now;if(e.tag>=1&&e.tag<=2)view.tags[e.tag-1].buttonCount=e.count;}
 Round r=roundCopy();snprintf(view.phase,sizeof(view.phase),"%s",!r.armed?"WAIT ENGINE":r.phase==Bid3::PAUSED?"PAUSED":r.phase==Bid3::COUNTDOWN?"BIDDING":r.phase==Bid3::LOCKED?"CLOSED":r.armed?"READY":"WAIT ENGINE");
 for(int tag=0;tag<2;++tag){auto&t=view.tags[tag];bool ready=seats[tag].ready.load();t.seen=seats[tag].linked.load();t.verified=ready&&seats[tag].authenticated.load();t.valid=false;if(t.seen)t.lastRadio=now;if(ready)t.lastProof=now;t.buttonKnown=ready;}
 if(oled.canQueue()&&uint32_t(now-lastFrame)>=1000/Config::DISPLAY_FPS){lastFrame=now;drawVisual(oled.screen,view,now,now-powerAt,Config::DISPLAY_LOCATION);oled.queueFrame();}
 if(!oled.service())peripheral.store(false);
 if(toggleDisplay.exchange(false)){oled.sh1106=!oled.sh1106;oled.reset();peripheral.store(false);Preferences p;if(p.begin("bt-ui",false)){p.putBool("sh1106",oled.sh1106);p.end();}}
 delay(1);
}
}
