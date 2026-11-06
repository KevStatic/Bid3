#pragma once
#include "FastCrypto.h"
#include "FastConfig.h"
#include "FastFeedback.h"
#include <cJSON.h>
namespace GatewayApp {
struct FastSlot{
 std::atomic<bool> live{false},auth{false},resync{false},proofSeen{false};std::atomic<uint32_t> lastAt{0},generation{0};
 uint8_t shared[32]={0},key[32]={0},nonce[32]={0},boot[8]={0},lastEvent[Fast::EVENT]={0};
 BLERemoteCharacteristic*channel=nullptr;SemaphoreHandle_t state=nullptr,io=nullptr;
 uint32_t ctrl=0,eventSeq=0,beatSeq=0,pendingSeq=0,attachAt=0;uint8_t pendingKind=0,lastResult=Fast::REFUSED;
 Fast::InputWindow inputWindow;Fast::SwitchState presence;
 bool pending=false,acked=false;char session[82]={0};
};
std::atomic<bool> fastFeature(false);
std::atomic<uint32_t> fastOverflow(0);std::atomic<uint32_t> fastWriteHandle[2]={{UINT32_MAX},{UINT32_MAX}},fastWriteAt[2]={{0},{0}};
FastSlot fastSlots[2];std::atomic<bool> fastKeysReady(false);
struct FastRx{uint8_t tag=0;uint16_t n=0;uint32_t at=0;uint8_t bytes[Fast::EVENT]={0};};
struct InputUi{uint8_t tag=0;bool held=false;uint32_t count=0,at=0,generation=0;};
struct FastAck{uint8_t tag=0,result=Fast::REFUSED;uint32_t seq=0;char session[82]={0};};
struct FastUi{uint8_t kind=0,tag=0;uint32_t count=0;uint64_t price=0;};
QueueHandle_t fastInputs=nullptr,fastInputUi=nullptr,fastEvents=nullptr,fastBeats=nullptr,fastAcks=nullptr,fastUi=nullptr,fastLegacy=nullptr;
std::atomic<uint32_t> roomAt(0),roomVersion(Fast::MISSING);std::atomic<uint8_t> roomPhase(Fast::PAUSED);
std::atomic<bool> engineUp(false),roomDirty(false);std::atomic<uint64_t> roomNext(0);
std::atomic<bool> fxPowered(false),fxFatal(false),fxActive(false),fxSensorWarning(false),fxActiveModule(false),fxActiveLow(false);
std::atomic<unsigned> fxFresh(0);QueueHandle_t fxQueue=nullptr;
std::atomic<uint32_t> fxLossEpoch[2]={{0},{0}};
struct FxRequest{uint8_t kind,tag;uint32_t epoch;};
bool cosmeticOnline(unsigned tag){auto&s=fastSlots[tag];return s.live.load()&&s.auth.load()&&uint32_t(millis()-s.lastAt.load())<1500;}
void queueSound(Audio::Kind kind,uint8_t tag=0){if((kind==Audio::NEARBY||kind==Audio::VERIFIED)&&roomVersion.load()!=Fast::MISSING&&(roomPhase.load()==Fast::OPEN||roomPhase.load()==Fast::COUNTDOWN||roomPhase.load()==Fast::CLOSED))return;
 if(!fastFeature.load()){sound.request(kind,tag);return;}if(!fxQueue)return;uint32_t epoch=tag>=1&&tag<=2?fxLossEpoch[tag-1].load():0;
 if(FastFeedback::cosmetic(kind)&&tag>=1&&tag<=2&&!FastFeedback::allow(kind,epoch,epoch,cosmeticOnline(tag-1)))return;
 FxRequest f{uint8_t(kind),tag,epoch};if(xQueueSend(fxQueue,&f,0)!=pdTRUE)Serial.println("BID3_FEEDBACK_ERROR=queue_full");}
void fastLink(int tag,const char*state){Serial.printf("BID3_LINK tag=TAG%d state=%s\n",tag+1,state);}
void fastLinkEvent(int tag,bool ok){Serial.printf("AUCTION_EVENT_JSON={\"kind\":\"LINK\",\"tag\":\"TAG%d\",\"link\":\"%s\"}\n",tag+1,ok?"OK":"LOST");}
void fastDrop(int tag){auto&s=fastSlots[tag];bool had=s.live.exchange(false);s.auth.store(false);if(had){fxLossEpoch[tag].fetch_add(1);fastLink(tag,"LOST");fastLinkEvent(tag,false);}}
void fastNotify(int tag,uint8_t*p,size_t n){
 if(!fastSlots[tag].live.load()||(n!=Fast::EVENT&&n!=Fast::HEARTBEAT))return;
 FastRx e;e.tag=tag;e.n=n;e.at=millis();memcpy(e.bytes,p,n);
 QueueHandle_t q=n==Fast::EVENT?fastEvents:!memcmp(p,"B5I1",4)?fastInputs:fastBeats;if(xQueueSend(q,&e,0)!=pdTRUE)fastOverflow.fetch_or(1u<<tag);
}
void fastNotify0(BLERemoteCharacteristic*,uint8_t*p,size_t n,bool){fastNotify(0,p,n);}
void fastNotify1(BLERemoteCharacteristic*,uint8_t*p,size_t n,bool){fastNotify(1,p,n);}
struct FastGuard{SemaphoreHandle_t m;explicit FastGuard(SemaphoreHandle_t x):m(x){if(m)xSemaphoreTake(m,portMAX_DELAY);}~FastGuard(){if(m)xSemaphoreGive(m);}};
struct FastAvailability{bool tracked=false,online=false,known=false,on=false;};
FastAvailability fastAvailability(unsigned tag,uint32_t now){
 auto&s=fastSlots[tag];FastGuard guard(s.state);
 return {s.generation.load()!=0,s.live.load()&&s.auth.load()&&uint32_t(now-s.lastAt.load())<1500,s.presence.known,s.presence.on};
}
bool fastAttach(int tag,BLERemoteService*service,const uint8_t proof[199]){
 fastSlots[tag].proofSeen.store(true);if(!fastKeysReady.load())return false;
 if(clients[tag]->getMTU()<Fast::EVENT+3){fastLink(tag,"LEGACY_PROOF_ONLY_MTU_LIMIT");return false;}auto*notify=service->getCharacteristic(Fast::UUID);auto*channel=service->getCharacteristic(Fast::CONTROL_UUID);
 if(!notify||!notify->canNotify()||!channel||!channel->canWrite()){fastLink(tag,"LEGACY_PROOF_ONLY");return false;}
 auto&s=fastSlots[tag];uint8_t derived[32];if(!FastCrypto::key(s.shared,proof,derived))return false;
 {FastGuard guard(s.state);memcpy(s.key,derived,32);memcpy(s.nonce,proof+94,32);memcpy(s.boot,proof+14,8);
  Fast::session(s.boot,s.nonce,s.session);s.channel=channel;s.generation.fetch_add(1);s.inputWindow={};s.presence={};s.ctrl=0;s.eventSeq=0;s.beatSeq=0;s.pending=false;s.acked=false;s.attachAt=millis();s.lastAt.store(s.attachAt);s.auth.store(false);s.live.store(true);}
 notify->registerForNotify(tag?fastNotify1:fastNotify0);
 // Optional live-channel tuning only; a declined update keeps the working interval.
 if(!clients[tag]->updateConnParams(6,12,0,200))fastLink(tag,"KEEPING_CURRENT_CONNECTION_INTERVAL");
 fastLink(tag,"BASELINE_VERIFIED_FAST_NEGOTIATING");return true;
}
bool fastControl(int tag,Fast::Command kind,uint32_t ref=0,uint8_t result=Fast::REFUSED){
 auto&s=fastSlots[tag];if(!s.live.load())return false;FastGuard io(s.io);if(!s.live.load()||!clients[tag]||!clients[tag]->isConnected())return false;
 uint8_t p[Fast::CONTROL]={0};BLERemoteCharacteristic*channel;
 {FastGuard guard(s.state);if(s.ctrl==UINT32_MAX){fastDrop(tag);return false;}
  memcpy(p,"B4C1",4);p[4]=1;p[5]=tag+1;p[6]=kind;memcpy(p+8,s.nonce,32);Fast::put32(p+40,++s.ctrl);Fast::put32(p+44,roomVersion.load());Fast::put32(p+48,ref);
  p[52]=roomPhase.load();p[53]=result;p[55]=engineUp.load()&&uint32_t(millis()-roomAt.load())<1500;Fast::put64(p+56,roomNext.load());channel=s.channel;
  if(!FastCrypto::mac(s.key,"Bid3.FastControl.v4",p,72))return false;}
 if(!channel)return false;fastWriteAt[tag].store(millis());fastWriteHandle[tag].store((uint32_t(clients[tag]->getGattcIf())<<16)|clients[tag]->getConnId());
 bool ok=channel->writeValue(p,sizeof(p),true);fastWriteHandle[tag].store(UINT32_MAX);return ok;
}
void fastCheckWrites(uint32_t now){for(int t=0;t<2;++t){uint32_t h=fastWriteHandle[t].load();if(h!=UINT32_MAX&&uint32_t(now-fastWriteAt[t].load())>1500&&fastWriteHandle[t].exchange(UINT32_MAX)!=UINT32_MAX)esp_ble_gattc_close(esp_gatt_if_t(h>>16),uint16_t(h));}}
void fastFeedbackTask(void*){
 uint32_t cancelledEpoch[2]={0,0};
 for(;;){
  if(sound.activeModule!=fxActiveModule.load()||sound.activeLow!=fxActiveLow.load()){sound.stop();sound.activeModule=fxActiveModule.load();sound.activeLow=fxActiveLow.load();}
  for(unsigned tag=0;tag<2;++tag){uint32_t epoch=fxLossEpoch[tag].load();if(epoch!=cancelledEpoch[tag]){sound.player.cancelCosmetic(tag+1);cancelledEpoch[tag]=epoch;}}
  FxRequest r;if(xQueuePeek(fxQueue,&r,0)==pdTRUE&&(!FastFeedback::outcome(sound.player.current.kind)||r.kind==Audio::NONE)){
   xQueueReceive(fxQueue,&r,0); // Finish an outcome cue before playing another bidder's cue.
   bool allowed=r.tag<1||r.tag>2||FastFeedback::allow(Audio::Kind(r.kind),r.epoch,fxLossEpoch[r.tag-1].load(),cosmeticOnline(r.tag-1));
   if(allowed){if(r.kind==Audio::NONE||r.kind==Audio::BID_ACCEPTED||r.kind==Audio::BID_REJECTED||r.kind==Audio::SOLD)sound.stop();
    if(r.kind!=Audio::NONE)sound.request(Audio::Kind(r.kind),r.tag);}
  }
  uint32_t now=millis();sound.tick(now,fxPowered.load()&&!fxFatal.load());
  auto duty=RuntimePolicy::leds(now,fxPowered.load(),fxFatal.load(),fxActive.load()&&!(roomVersion.load()!=Fast::MISSING&&roomPhase.load()==Fast::PAUSED),fxFresh.load(),fxSensorWarning.load(),false,Config::GREEN_DUTY_MAX,Config::RED_DUTY_MAX);
  duty=FastFeedback::leds(sound.player.current.kind,sound.sounding()&&!fxFatal.load(),duty,Config::GREEN_DUTY_MAX,Config::RED_DUTY_MAX);
  if(ledsReady){ledcWrite(Config::GREEN_PIN,duty.green);ledcWrite(Config::RED_PIN,duty.red);}
  vTaskDelay(pdMS_TO_TICKS(1));
 }
}
uint8_t parseRoomPhase(const char*s){return !s?Fast::PAUSED:!strcmp(s,"OPEN")?Fast::OPEN:!strcmp(s,"COUNTDOWN")?Fast::COUNTDOWN:!strcmp(s,"LOBBY")?Fast::LOBBY:!strcmp(s,"SOLD_LOCKED")||!strcmp(s,"UNSOLD")||!strcmp(s,"CANCELLED")?Fast::CLOSED:Fast::PAUSED;}
bool jsonInteger(const cJSON*x,uint32_t&out){if(!cJSON_IsNumber(x)||x->valuedouble<0||x->valuedouble>UINT32_MAX||double(uint32_t(x->valuedouble))!=x->valuedouble)return false;out=uint32_t(x->valuedouble);return true;}
void fastCommand(char*line){
 if(!strcmp(line,"CMD=STATUS")){for(int t=0;t<2;++t)if(fastSlots[t].auth.load()){auto state=fastAvailability(t,millis());if(!state.known||state.on)fastLinkEvent(t,true);fastSlots[t].resync.store(true);}return;}
 const char*body=nullptr;enum{NO,STATE,ACK,HEALTH}type=NO;
 if(!strncmp(line,"AUCTION_STATE_JSON=",19)){body=line+19;type=STATE;}
 else if(!strncmp(line,"AUCTION_ACK_JSON=",17)){body=line+17;type=ACK;}
 else if(!strncmp(line,"AUCTION_BRIDGE_JSON=",20)){body=line+20;type=HEALTH;}
 if(!body)return;cJSON*j=cJSON_Parse(body);if(!j||!cJSON_IsObject(j)){cJSON_Delete(j);return;}
 if(type==HEALTH){auto*x=cJSON_GetObjectItemCaseSensitive(j,"engine");bool up=cJSON_IsString(x)&&!strcmp(x->valuestring,"ok");bool wasUp=engineUp.exchange(up);roomAt.store(millis());if(up&&!wasUp)for(auto&s:fastSlots)if(s.live.load())s.resync.store(true);if(!up){roomPhase.store(Fast::PAUSED);roomDirty.store(true);}}
 if(type==STATE){uint32_t version;auto*phase=cJSON_GetObjectItemCaseSensitive(j,"phase");auto*next=cJSON_GetObjectItemCaseSensitive(j,"next");
  bool hasVersion=jsonInteger(cJSON_GetObjectItemCaseSensitive(j,"stateVersion"),version);if(hasVersion)roomVersion.store(version);
  if(cJSON_IsString(phase)){uint8_t parsed=parseRoomPhase(phase->valuestring);uint8_t old=roomPhase.exchange(parsed);
   if(parsed==Fast::LOBBY||parsed==Fast::OPEN){FastUi reset;reset.kind=4;xQueueSend(fastUi,&reset,0);}
   if(!strcmp(phase->valuestring,"SOLD_LOCKED")&&old!=Fast::CLOSED){queueSound(Audio::SOLD);FastUi sold;sold.kind=3;
   auto*price=cJSON_GetObjectItemCaseSensitive(j,"price");if(cJSON_IsNumber(price)&&price->valuedouble>=0&&price->valuedouble<=9007199254740991.0)sold.price=uint64_t(price->valuedouble);
   auto*tags=cJSON_GetObjectItemCaseSensitive(j,"tags");for(int t=0;t<2;++t){auto*seat=cJSON_GetObjectItemCaseSensitive(tags,t?"TAG2":"TAG1");if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(seat,"leader")))sold.tag=t+1;}xQueueSend(fastUi,&sold,0);}
  }
  if(cJSON_IsNumber(next)&&next->valuedouble>=0&&next->valuedouble<=9007199254740991.0&&double(uint64_t(next->valuedouble))==next->valuedouble)roomNext.store(uint64_t(next->valuedouble));
  if(hasVersion){engineUp.store(true);roomAt.store(millis());roomDirty.store(true);}
 }
 if(type==ACK){auto*tag=cJSON_GetObjectItemCaseSensitive(j,"tag");auto*sid=cJSON_GetObjectItemCaseSensitive(j,"session");auto*result=cJSON_GetObjectItemCaseSensitive(j,"result");uint32_t seq;
  if(cJSON_IsString(tag)&&cJSON_IsString(sid)&&cJSON_IsString(result)&&jsonInteger(cJSON_GetObjectItemCaseSensitive(j,"seq"),seq)){
   int t=!strcmp(tag->valuestring,"TAG1")?0:!strcmp(tag->valuestring,"TAG2")?1:-1;
   if(t>=0&&strlen(sid->valuestring)==81){FastAck a;a.tag=t;a.seq=seq;a.result=!strcmp(result->valuestring,"ACCEPTED")?Fast::ACCEPTED:Fast::REFUSED;memcpy(a.session,sid->valuestring,82);if(xQueueSend(fastAcks,&a,0)!=pdTRUE)fastDrop(t);}
  }
 }
 cJSON_Delete(j);
}
void fastSerialTask(void*){
 char line[2048];size_t used=0;bool overflow=false;
 for(;;){for(unsigned i=0;i<256&&Serial.available();++i){char c=Serial.read();if(c=='\r')continue;
   if(!used&&!overflow&&c&&strchr("dspbmiDSPBMI",c)){xQueueSend(fastLegacy,&c,0);continue;}
   if(c!='\n'){if(!overflow&&used+1<sizeof(line))line[used++]=c;else overflow=true;continue;}
   if(!overflow){line[used]=0;fastCommand(line);}else{engineUp.store(false);roomPhase.store(Fast::PAUSED);Serial.println("BID3_SERIAL_ERROR=line_too_long");}
   used=0;overflow=false;
  }vTaskDelay(pdMS_TO_TICKS(1));}
}
void forwardFastEvent(int t,const uint8_t*p){
 char sid[82],sig[129];Fast::session(p+56,p+8,sid);Fast::hex(p+64,64,sig);
 if(p[6]==Fast::BID)Serial.printf("AUCTION_EVENT_JSON={\"kind\":\"BID\",\"tag\":\"TAG%d\",\"session\":\"%s\",\"seq\":%lu,\"stateVersion\":%lu,\"sig\":\"%s\"}\n",t+1,sid,(unsigned long)Fast::get32(p+40),(unsigned long)Fast::get32(p+44),sig);
 else Serial.printf("AUCTION_EVENT_JSON={\"kind\":\"%s\",\"tag\":\"TAG%d\",\"session\":\"%s\",\"seq\":%lu,\"sig\":\"%s\"}\n",Fast::kindName(p[6]),t+1,sid,(unsigned long)Fast::get32(p+40),sig);
}
// This task never waits for a GATT write, ECDSA verification or engine decision.
void fastInputWorker(void*){
 FastRx e;
 for(;;){if(xQueueReceive(fastInputs,&e,portMAX_DELAY)!=pdTRUE)continue;
  auto&s=fastSlots[e.tag];InputUi u;
  {FastGuard guard(s.state);uint32_t count=Fast::get32(e.bytes+52);
   if(!s.live.load()||!Fast::inputFields(e.bytes,e.n,e.tag+1,s.nonce,s.boot)||!s.inputWindow.eligible(e.bytes)||!FastCrypto::check(s.key,Fast::INPUT_DOMAIN,e.bytes,64))continue;
   s.inputWindow.commit(e.bytes);s.lastAt.store(e.at);u.tag=e.tag;u.held=e.bytes[7];u.count=count;u.at=e.at;u.generation=s.generation.load();
  }
  if(xQueueSend(fastInputUi,&u,0)!=pdTRUE)fastOverflow.fetch_or(1u<<e.tag);
 }
}
void fastWorker(void*){
 mbedtls_ecp_keypair peers[2];for(auto&p:peers)mbedtls_ecp_keypair_init(&p);while(!fastKeysReady.load())vTaskDelay(pdMS_TO_TICKS(20));
 for(int t=0;t<2;++t)if(!FastCrypto::publicKey(peers[t],Security::tags[t].pub)){vTaskDelete(nullptr);return;}
 uint32_t lastControl=0,lastStatus=0;
 for(;;){
  uint32_t overflow=fastOverflow.exchange(0);for(int t=0;t<2;++t)if(overflow&(1u<<t))fastDrop(t);
  FastAck a;while(xQueueReceive(fastAcks,&a,0)==pdTRUE){auto&s=fastSlots[a.tag];uint8_t kind=0;uint32_t count=0;
   {FastGuard guard(s.state);if(!s.live.load()||!s.pending||a.seq!=s.pendingSeq||strcmp(a.session,s.session))continue;s.pending=false;s.acked=true;s.lastResult=a.result;kind=s.pendingKind;count=Fast::get32(s.lastEvent+52);}
   if(kind==Fast::BID){queueSound(a.result==Fast::ACCEPTED?Audio::BID_ACCEPTED:Audio::BID_REJECTED,a.tag+1);FastUi u{uint8_t(a.result==Fast::ACCEPTED?1:2),uint8_t(a.tag+1),count};xQueueSend(fastUi,&u,0);}fastControl(a.tag,Fast::ACK,a.seq,a.result);
  }
  FastRx e;while(xQueueReceive(fastBeats,&e,0)==pdTRUE){auto&s=fastSlots[e.tag];bool first=false;
   {FastGuard guard(s.state);auto*p=e.bytes;uint32_t seq=Fast::get32(p+40);
    if(!s.live.load()||!Fast::heartbeatFields(p,e.n,e.tag+1,s.nonce,s.boot)||seq<=s.beatSeq||!FastCrypto::check(s.key,"Bid3.FastHeartbeat.v4",p,64))continue;
    s.beatSeq=seq;s.presence.observe(p[7]!=0,Fast::get32(p+48));s.lastAt.store(e.at);first=!s.auth.exchange(true);}
   if(first){fastLink(e.tag,"FAST_READY");auto state=fastAvailability(e.tag,millis());if(state.on)fastLinkEvent(e.tag,true);}
  }
  if(xQueueReceive(fastEvents,&e,0)==pdTRUE){auto&s=fastSlots[e.tag];uint8_t keyCopy[32];bool duplicate=false,alreadyAcked=false;uint8_t result=0;uint32_t seq=Fast::get32(e.bytes+40);
   {FastGuard guard(s.state);if(!s.live.load()||!Fast::eventFields(e.bytes,e.n,e.tag+1,s.nonce,s.boot)||!FastCrypto::check(s.key,"Bid3.FastEvent.v4",e.bytes,128))continue;
    if(seq==s.eventSeq&&!memcmp(e.bytes,s.lastEvent,Fast::EVENT)){duplicate=true;alreadyAcked=s.acked;result=s.lastResult;}
    else if(seq<=s.eventSeq||s.pending||seq!=s.eventSeq+1)continue;memcpy(keyCopy,s.key,32);}
   if(duplicate){if(alreadyAcked)fastControl(e.tag,Fast::ACK,seq,result);continue;}
   uint32_t at=micros();if(!FastCrypto::verify(peers[e.tag],e.bytes))continue;uint32_t verifyUs=micros()-at;
   {FastGuard guard(s.state);if(!s.live.load()||memcmp(keyCopy,s.key,32))continue;s.eventSeq=seq;s.pending=true;s.pendingSeq=seq;s.pendingKind=e.bytes[6];s.acked=false;memcpy(s.lastEvent,e.bytes,Fast::EVENT);s.lastAt.store(e.at);if(e.bytes[6]==Fast::JOIN||e.bytes[6]==Fast::LEAVE)s.presence.observe(e.bytes[6]==Fast::JOIN,Fast::get32(e.bytes+48));}
   auto state=fastAvailability(e.tag,millis());bool offBlocked=state.known&&!state.on&&(e.bytes[6]==Fast::BID||e.bytes[6]==Fast::JOIN);
   bool offline=!engineUp.load()||roomVersion.load()==Fast::MISSING||uint32_t(millis()-roomAt.load())>=1500;
   if((offline||offBlocked)&&e.bytes[6]!=Fast::PRESS){
    uint8_t local=offBlocked||e.bytes[6]==Fast::BID?Fast::REFUSED:Fast::RECEIVED;
    {FastGuard guard(s.state);s.pending=false;s.acked=true;s.lastResult=local;}
    // Receipt is not auction admission. Keep standalone detection connected.
    fastControl(e.tag,Fast::ACK,seq,local);
   }else if(e.bytes[6]==Fast::PRESS){
    {FastGuard guard(s.state);s.pending=false;s.acked=true;s.lastResult=Fast::RECEIVED;}
    fastControl(e.tag,Fast::ACK,seq,Fast::RECEIVED);postButton(e.tag,Fast::get32(e.bytes+52),1,false,false);
    Serial.printf("BUTTON_FAST_JSON={\"tag\":%d,\"verified\":true,\"seq\":%lu,\"verify_us\":%lu,\"diagnostic\":true}\n",e.tag+1,(unsigned long)seq,(unsigned long)verifyUs);
   }else forwardFastEvent(e.tag,e.bytes);
  }
  uint32_t lastRoom=roomAt.load(),now=millis();
  if(uint32_t(now-lastStatus)>=500){lastStatus=now;Serial.printf("AUCTION_STATUS_JSON={\"build\":\"V4_WORKING_BASE\",\"firmware\":\"V6_RECONNECT_FEEDBACK_FIX\",\"running\":true,\"tag1_fast\":%u,\"tag2_fast\":%u,\"tag1_proof_seen\":%u,\"tag2_proof_seen\":%u}\n",fastSlots[0].auth.load(),fastSlots[1].auth.load(),fastSlots[0].proofSeen.load(),fastSlots[1].proofSeen.load());}if(engineUp.load()&&uint32_t(now-lastRoom)>1500){engineUp.store(false);roomPhase.store(Fast::PAUSED);}
  bool controlDue=roomDirty.exchange(false)||uint32_t(now-lastControl)>=200;
  for(int t=0;t<2;++t){auto&s=fastSlots[t];if(!s.live.load())continue;
   uint32_t heard=s.lastAt.load();now=millis();if(!clients[t]->isConnected()||uint32_t(now-heard)>(s.auth.load()?1500u:8000u)){fastDrop(t);FastGuard io(s.io);if(clients[t]->isConnected())clients[t]->disconnect();continue;}
   if(controlDue)fastControl(t,s.auth.load()?(s.resync.exchange(false)?Fast::RESYNC:Fast::STATE):Fast::INIT);
  }
  if(controlDue)lastControl=now;vTaskDelay(pdMS_TO_TICKS(1));
 }
}
bool fastGatewayInit(){
 if(!BID3_ENABLE_FAST_CHANNEL)return false;
 fastInputs=xQueueCreate(24,sizeof(FastRx));fastInputUi=xQueueCreate(24,sizeof(InputUi));
 fastEvents=xQueueCreate(16,sizeof(FastRx));fastBeats=xQueueCreate(16,sizeof(FastRx));fastAcks=xQueueCreate(16,sizeof(FastAck));fastUi=xQueueCreate(16,sizeof(FastUi));fastLegacy=xQueueCreate(16,sizeof(char));fxQueue=xQueueCreate(12,sizeof(FxRequest));
 for(auto&s:fastSlots){s.state=xSemaphoreCreateMutex();s.io=xSemaphoreCreateMutex();}
 return fastInputs&&fastInputUi&&fastEvents&&fastBeats&&fastAcks&&fastUi&&fastLegacy&&fxQueue&&fastSlots[0].state&&fastSlots[1].state&&fastSlots[0].io&&fastSlots[1].io;
}
bool fastGatewayKeys(){for(int t=0;t<2;++t)if(!FastCrypto::shared(Security::own,Security::tags[t].pub,Security::rng,fastSlots[t].shared))return false;fastKeysReady.store(true);return true;}
}
