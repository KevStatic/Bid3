#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEClient.h>
#include <BLEAdvertisedDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <atomic>
#include <freertos/semphr.h>
#include <esp_gattc_api.h>
#include "RuntimePolicy.h"
#include "ButtonSecurity.h"
#include "ButtonTracker.h"
#include "Oled.h"
#include "Crypto.h"
#include "VerifierSelfTest.h"
#include "SoundOutput.h"
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Select ESP32 Dev Module for the ESP32-WROOM gateway."
#endif
namespace GatewayApp {
constexpr char SERVICE[]="b7610001-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char INFO[]="b7610002-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char CHALLENGE[]="b7610004-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char RESPONSE[]="b7610005-7e1d-4e8b-9a73-8f1b0c4d9000";
struct Event{uint8_t type,tag;int16_t rssi,norm;uint32_t at;bool valid,moving;char label[20];uint8_t digest[8];
 uint32_t buttonCount,buttonDelta;bool buttonHeld,buttonBaseline;};
ButtonTracker::State buttons[2];
#if !defined(CONFIG_BLUEDROID_ENABLED)
#error "This gateway release is tested with the bundled Bluedroid stack in ESP32 core 3.3.12."
#endif
QueueHandle_t events=nullptr;std::atomic<bool> active(false),securityReady(false);Oled oled;View view;
struct Candidate {uint8_t address[6]={0};uint8_t type=0;int16_t rssi=-127;uint32_t at=0;bool seen=false;};
Candidate candidates[2];portMUX_TYPE candidateLock=portMUX_INITIALIZER_UNLOCKED;
SemaphoreHandle_t scanLock=nullptr;BLEScan*scanner=nullptr;BLEClient*clients[2]={nullptr,nullptr};
std::atomic<bool> connecting(false),scanRunning(false),cancelRequested(false);
std::atomic<uint32_t> linkHandle(UINT32_MAX),linkAt(0),workerAt(0),scanRestarts(0);
Candidate candidateCopy(int tag){portENTER_CRITICAL(&candidateLock);Candidate c=candidates[tag];portEXIT_CRITICAL(&candidateLock);return c;}

bool ledsReady=false;SoundOutput sound;uint32_t powerAt=0,lastFrame=0,lastSerial=0,errorUntil=0;
void post(uint8_t type,int tag=0,int rssi=-127,const char*label="",const uint8_t*p=nullptr,const uint8_t*digest=nullptr){
 Event e={};e.type=type;e.tag=tag;e.rssi=rssi;e.at=millis();snprintf(e.label,sizeof(e.label),"%s",label);
 if(p){e.valid=p[6]&1;e.moving=p[6]&2;float a=int16_t(Security::get16(p+32)),b=int16_t(Security::get16(p+34)),c=int16_t(Security::get16(p+36));e.norm=int16_t(std::min(30000.f,std::fabs(std::sqrt(a*a+b*b+c*c)-1000.f)));}
 if(digest)memcpy(e.digest,digest,8);if(events)xQueueSend(events,&e,0);
}
int tagHint(BLEAdvertisedDevice&d){if(!d.haveManufacturerData())return -1;String m=d.getManufacturerData();if(m.length()!=6||(uint8_t)m[0]!=255||(uint8_t)m[1]!=255||m[2]!='B'||m[3]!='T'||m[4]!=1)return -1;return m[5]>=1&&m[5]<=2?m[5]-1:-1;}
void exportScan(int tag,int rssi,const uint8_t*p,const uint8_t*scan,const uint8_t*digest){
 String s;s.reserve(1800);s="SCAN_JSON={\"schema\":\"bagtrail.scan.v1\",\"tag\":";s+=tag+1;
 s+=",\"checkpoint_id\":\"";s+=Config::CHECKPOINT_ID;s+="\",\"gateway_uuid_hex\":\"";s+=Security::hex(Security::gateway,16);
 s+="\",\"rssi_dbm\":";s+=rssi;s+=",\"tag_verified\":true,\"unix_time\":null,\"gateway_uptime_ms\":";s+=Security::get32(scan+68);
 s+=",\"sensor_valid\":";s+=(p[6]&1)?"true":"false";s+=",\"moving\":";s+=(p[6]&2)?"true":"false";
 s+=",\"tag_proof_hex\":\"";s+=Security::hex(p,190);s+="\",\"gateway_scan_hex\":\"";s+=Security::hex(scan,328);
 s+="\",\"gateway_scan_sha256\":\"";s+=Security::hex(digest,32);s+="\"}";s+="\n";Serial.print(s);
}
void postButton(int tag,uint32_t count,uint32_t delta,bool held,bool baseline){
 Event e={};e.type=5;e.tag=tag+1;e.at=millis();e.buttonCount=count;e.buttonDelta=delta;e.buttonHeld=held;e.buttonBaseline=baseline;
 if(events&&xQueueSend(events,&e,0)!=pdTRUE)Serial.println("BUTTON_UI_WARNING=queue_full; signed Serial state remains authoritative");
}
void exportButton(int tag,int rssi,const uint8_t*p,const uint8_t*scan,const uint8_t*digest,const ButtonTracker::Decision&decision){
 String s;s.reserve(2200);s="BUTTON_STATE_JSON={\"schema\":\"bagtrail.button_scan.v1\",\"tag\":";s+=tag+1;
 s+=",\"gateway_uuid_hex\":\"";s+=Security::hex(Security::gateway,16);
 s+="\",\"tag_boot_id_hex\":\"";s+=Security::hex(p+14,8);
 s+="\",\"gateway_uptime_ms\":";s+=Security::get32(scan+68);
 s+=",\"tag_uptime_ms\":";s+=Security::get32(p+26);
 s+=",\"press_count\":";s+=Security::get32(p+126);
 s+=",\"last_press_tag_uptime_ms\":";s+=Security::get32(p+130);
 s+=",\"button_pressed\":";s+=p[134]?"true":"false";
 s+=",\"press_delta\":";s+=decision.delta;
 s+=",\"baseline\":";s+=decision.kind==ButtonTracker::BASELINE?"true":"false";
 s+=",\"verified\":true,\"rssi_dbm\":";s+=rssi;
 s+=",\"gateway_button_scan_hex\":\"";s+=Security::hex(scan,ButtonWire::SCAN);
 s+="\",\"signed_digest_sha256\":\"";s+=Security::hex(digest,32);s+="\"}";s+="\n";Serial.print(s);
 if(decision.kind==ButtonTracker::PRESS){
  Serial.printf("TAG%02d BUTTON PRESSED | +%lu | total=%lu | held=%s\n",tag+1,(unsigned long)decision.delta,(unsigned long)Security::get32(p+126),p[134]?"YES":"NO");
  Serial.printf("BUTTON_EVENT_JSON={\"schema\":\"bagtrail.button_event.v1\",\"kind\":\"PRESS_COUNT_ADVANCE\",\"tag\":%d,\"press_count\":%lu,\"press_delta\":%lu,\"tag_boot_id_hex\":\"%s\",\"scan_digest_sha256\":\"%s\"}\n",
   tag+1,(unsigned long)Security::get32(p+126),(unsigned long)decision.delta,Security::hex(p+14,8).c_str(),Security::hex(digest,32).c_str());
 }else if(decision.kind==ButtonTracker::BASELINE){
  Serial.printf("TAG%02d BUTTON SYNC | count_since_wake=%lu | held=%s | baseline; not a new live press\n",tag+1,(unsigned long)Security::get32(p+126),p[134]?"YES":"NO");
 }
}
class Discoveries:public BLEAdvertisedDeviceCallbacks {
 void onResult(BLEAdvertisedDevice d)override{
  if(!d.haveServiceUUID()||!d.isAdvertisingService(BLEUUID(SERVICE)))return;
  int tag=tagHint(d);if(tag<0)return;Candidate c;
  memcpy(c.address,d.getAddress().getNative(),6);c.type=d.getAddressType();c.rssi=d.getRSSI();c.at=millis();c.seen=true;
  portENTER_CRITICAL(&candidateLock);candidates[tag]=c;portEXIT_CRITICAL(&candidateLock);
  // No connect, signature work, display I/O or Serial printing in the BT callback.
 }
} discoveries;
void scanEnded(BLEScanResults){scanRunning.store(false);}
void maintainScan(){
 if(!scanner||connecting.load()||!active.load())return;
 if(xSemaphoreTake(scanLock,pdMS_TO_TICKS(5))!=pdTRUE)return;
 if(!connecting.load()&&!scanner->isScanning()){
  bool ok=scanner->start(0,scanEnded,false);scanRunning.store(ok);if(ok)++scanRestarts;
 }else scanRunning.store(scanner->isScanning());
 xSemaphoreGive(scanLock);
}
// Async close releases the SDK's waiting read/write/discovery semaphores.
// It never runs a blocking BLEClient::disconnect on the UI task.
void checkLinkDeadline(uint32_t now){
 uint32_t h=linkHandle.load();if(h==UINT32_MAX||uint32_t(now-linkAt.load())<7000)return;
 if(!cancelRequested.exchange(true))esp_ble_gattc_close(esp_gatt_if_t(h>>16),uint16_t(h));
}
} // namespace GatewayApp
#include "FastGateway.h"
namespace GatewayApp {
bool transact(BLEClient*client,const Candidate&candidate,int tag){
 FastGuard io(fastSlots[tag].io);
 char phase[12];snprintf(phase,sizeof(phase),"LINK%02d",tag+1);post(0,tag+1,candidate.rssi,phase);
 uint8_t address[6];memcpy(address,candidate.address,6);
 connecting.store(true);cancelRequested.store(false);
 if(xSemaphoreTake(scanLock,pdMS_TO_TICKS(250))!=pdTRUE){connecting.store(false);return false;}
 bool connected=client->connect(BLEAddress(address,candidate.type),candidate.type,1800); // SDK stops scan for connection establishment only
 xSemaphoreGive(scanLock);connecting.store(false);maintainScan();
 if(!connected){post(0,tag+1,-127,"RECONNECT");return false;}
 linkAt.store(millis());linkHandle.store((uint32_t(client->getGattcIf())<<16)|client->getConnId());
 auto work=[&]()->bool{
  if(cancelRequested.load())return false;
  if(!client->setMTU(247)||client->getMTU()<193){post(0,tag+1,-127,"MTU RETRY");return false;}
  client->getServices(); // SDK clears old remote handles at each reconnect
  BLERemoteService*svc=client->getService(SERVICE);if(!svc)return false;
  auto*info=svc->getCharacteristic(INFO);auto*requestChar=svc->getCharacteristic(CHALLENGE);auto*response=svc->getCharacteristic(RESPONSE);
  if(!info||!requestChar||!response||!info->canRead()||!requestChar->canWrite()||!response->canRead())return false;
  String identity=info->readValue();
  if(!Security::infoMatches((const uint8_t*)identity.c_str(),identity.length(),tag)){
   if(client->isConnected()&&!cancelRequested.load()){Serial.printf("REJECTED_TAG=%d reason=enrollment_mismatch\n",tag+1);post(3,tag+1,candidate.rssi,"KEY ERR");}return false;}
  if(cancelRequested.load())return false;
  uint8_t request[84];if(!ButtonSecurity::makeChallenge(request))return false;
  uint32_t issued=millis();bool pending=true;snprintf(phase,sizeof(phase),"AUTH%02d",tag+1);post(0,tag+1,candidate.rssi,phase);
  if(!requestChar->writeValue(request,sizeof(request),true))return false;
  while(!cancelRequested.load()&&client->isConnected()&&millis()-issued<=5000){
   String result=response->readValue();
   if(cancelRequested.load())return false;
   if(result.length()==ButtonWire::PROOF){
    const uint8_t*p=(const uint8_t*)result.c_str();uint8_t tagDigest[32];
    if(memcmp(p+94,request+52,32)){vTaskDelay(pdMS_TO_TICKS(50));continue;}
    if(!ButtonSecurity::verifyProof(p,result.length(),tag,request,pending,millis()-issued,tagDigest)){
     Serial.printf("REJECTED_TAG=%d reason=proof_verification_failed\n",tag+1);post(3,tag+1,candidate.rssi,"SIG ERR");return false;}
    uint32_t observed=millis();Candidate latest=candidateCopy(tag);int rssi=latest.rssi;
    const uint32_t count=Security::get32(p+126),proofSequence=Security::get32(p+22);
    auto decision=buttons[tag].inspect(p+14,count,proofSequence,p[134]!=0);
    if(decision.kind==ButtonTracker::INVALID){post(3,tag+1,rssi,"COUNT ERR");return false;}
    uint8_t scan[ButtonWire::SCAN],scanDigest[32];
    if(!ButtonSecurity::scanEnvelope(p,rssi,observed,scan,scanDigest)){post(3,tag+1,rssi,"SIGNERR");return false;}
    if(cancelRequested.load())return false;
    buttons[tag].commit(p+14,count,proofSequence,p[134]!=0);
    post(2,tag+1,rssi,"VERIFIED",p,scanDigest);
    postButton(tag,count,decision.delta,p[134]!=0,decision.kind==ButtonTracker::BASELINE);
    exportButton(tag,rssi,p,scan,scanDigest,decision);fastAttach(tag,svc,p);return true;
   }
   if(result.length()==2&&result[0]=='E'){Serial.printf("TAG_ERROR tag=%d code=%u\n",tag+1,(uint8_t)result[1]);return false;}
   vTaskDelay(pdMS_TO_TICKS(50));
  }
  return false;
 };
 bool ok=work();linkHandle.store(UINT32_MAX);
 if(client->isConnected()&&!fastSlots[tag].live.load())client->disconnect(); // working-base fallback; UI and discovery remain independent
 if(!ok)post(0,tag+1,candidate.rssi,"RECONNECT");
 return ok;
}
void proofTask(void*){
 RuntimePolicy::Retry retries[2];int next=0;
 for(;;){workerAt.store(millis());Candidate c[2]={candidateCopy(0),candidateCopy(1)};
  bool seen[2]={c[0].seen&&!fastSlots[0].live.load(),c[1].seen&&!fastSlots[1].live.load()};uint32_t at[2]={c[0].at,c[1].at};
  int tag=active.load()?RuntimePolicy::selectTag(millis(),next,seen,at,retries):-1;
  if(tag>=0){bool ok=transact(clients[tag],c[tag],tag);retries[tag].finish(millis(),ok,Config::PROOF_INTERVAL_MS);next=(tag+1)%2;}
  else post(0,0,-127,"SCANNING");
  vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void radioTask(void*){
 // Provisioning/key self-tests can be slow. Keep them off the OLED/audio task.
 if(!Security::init()||!externalVerifierSelfTest()){post(4,0,-127,"CRYPTO FAIL");vTaskDelete(nullptr);return;}
 if(fastFeature.load()&&!fastGatewayKeys())Serial.println("BID3_FAST=unavailable; original signed snapshot path remains active");
 securityReady.store(true);Security::printPublic();BLEDevice::init("BagTrail-Gateway");BLEDevice::setMTU(247);
 scanner=BLEDevice::getScan();clients[0]=BLEDevice::createClient();clients[1]=BLEDevice::createClient();
 if(!scanner||!clients[0]||!clients[1]){post(4,0,-127,"BLE FAIL");vTaskDelete(nullptr);return;}
 scanner->setActiveScan(true);scanner->setInterval(100);scanner->setWindow(80);
 // Bluedroid frees each advertised-device object after this callback. No unbounded scan-result map.
 scanner->setAdvertisedDeviceCallbacks(&discoveries,true);
 active.store(true);TaskHandle_t handle=nullptr;
 if(xTaskCreatePinnedToCore(proofTask,"tag-proofs",12288,nullptr,1,&handle,0)!=pdPASS){active.store(false);post(4,0,-127,"TASK FAIL");vTaskDelete(nullptr);return;}
 uint32_t reported[2]={0,0};
 for(;;){maintainScan();for(int tag=0;tag<2;++tag){Candidate c=candidateCopy(tag);
   if(c.seen&&c.at!=reported[tag]){reported[tag]=c.at;post(1,tag+1,c.rssi,"RADIO");}}
  vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void stopBeep(){if(fastFeature.load())queueSound(Audio::NONE);else sound.stop();}
void beep(){if(oled.ready&&!view.fatal)queueSound(Audio::STARTUP);}
void saveAudio(){Preferences ui;if(ui.begin("bt-ui",false)){ui.putBool("activeBuzzer",fxActiveModule.load());ui.putBool("activeLow",fxActiveLow.load());ui.end();}}
void printAudio(){Serial.printf("AUDIO enabled=%u pin=GPIO27 mode=%s polarity=%s; b=play startup, m=change module mode, i=active trigger polarity\n",
 Config::ENABLE_BUZZER,fxActiveModule.load()?"ACTIVE (rhythm only)":"PASSIVE (pitched melody)",fxActiveLow.load()?"LOW":"HIGH");}
void setupGateway(){
 Serial.setTxBufferSize(8192);Serial.setRxBufferSize(8192);Serial.begin(115200);pinMode(Config::GREEN_PIN,OUTPUT);pinMode(Config::RED_PIN,OUTPUT);
 digitalWrite(Config::GREEN_PIN,LOW);digitalWrite(Config::RED_PIN,LOW);stopBeep();
 ledsReady=ledcAttach(Config::GREEN_PIN,5000,8)&&ledcAttach(Config::RED_PIN,5000,8);
 if(ledsReady){ledcWrite(Config::GREEN_PIN,0);ledcWrite(Config::RED_PIN,0);}
 events=xQueueCreate(32,sizeof(Event));scanLock=xSemaphoreCreateMutex();oled.begin();
 Preferences ui;if(ui.begin("bt-ui",true)){oled.sh1106=ui.getBool("sh1106",Config::DEFAULT_SH1106);sound.activeModule=ui.getBool("activeBuzzer",Config::DEFAULT_ACTIVE_BUZZER);sound.activeLow=ui.getBool("activeLow",Config::DEFAULT_ACTIVE_LOW);ui.end();}
 fastFeature.store(fastGatewayInit());fxActiveModule.store(sound.activeModule);fxActiveLow.store(sound.activeLow);
 Serial.println("\nBid3 V6 TAG_OFF_FIX / original BT discovery and BTB1 signed proofs / 115200 baud");
 Serial.println("Upload the matching V6 tag sketches. Fast input begins only after the original enrolled proof verifies.");
 Serial.println("NO GPIO33 required. BLE runs while USB-powered, independently of OLED/switch availability.");
 if(!events||!scanLock||!ledsReady){view.fatal=true;Serial.println("FATAL: queue, LED PWM, cryptographic identity or verifier self-test failed.");}
 else{TaskHandle_t handle=nullptr;
  if(xTaskCreatePinnedToCore(radioTask,"bagtrail-radio",12288,nullptr,1,&handle,0)!=pdPASS){view.fatal=true;Serial.println("FATAL: radio task creation failed.");}}
 Serial.println("Commands: d=toggle/save OLED driver; p=public gateway identity; s=status; b=startup melody; m=passive/active buzzer; i=active trigger polarity.");
 if(fastFeature.load()){TaskHandle_t task=nullptr;
  if(xTaskCreatePinnedToCore(fastInputWorker,"bid3-input",4096,nullptr,3,&task,1)!=pdPASS||xTaskCreatePinnedToCore(fastWorker,"bid3-fast",12288,nullptr,2,&task,0)!=pdPASS||xTaskCreatePinnedToCore(fastSerialTask,"bid3-serial",6144,nullptr,2,&task,1)!=pdPASS||xTaskCreatePinnedToCore(fastFeedbackTask,"bid3-feedback",4096,nullptr,3,&task,1)!=pdPASS){view.fatal=true;Serial.println("BID3_FATAL=fast_task_allocation");}
 }
 printAudio();
}
void loopGateway(){
 uint32_t now=millis();
 checkLinkDeadline(now);fastCheckWrites(now);view.radioReady=active.load();
 if(oled.probe(now)){powerAt=now;fxPowered.store(true);if(!view.fatal)queueSound(Audio::STARTUP);
  Serial.printf("OLED ready: %s at 0x%02X; BLE independent.\n",oled.sh1106?"SH1106":"SSD1306",oled.address);}
 Event e;unsigned handled=0;while(events&&handled++<8&&xQueueReceive(events,&e,0)==pdTRUE){
  if(e.type==4){view.fatal=true;active.store(false);}
  if(e.type!=1)snprintf(view.phase,sizeof(view.phase),"%s",e.label);
  if(e.tag<1||e.tag>2)continue;TagView&t=view.tags[e.tag-1];
  if(e.type==1){bool arrived=!t.seen||uint32_t(e.at-t.lastRadio)>=Config::TAG_RETURN_MS;
   t.seen=true;t.lastRadio=e.at;t.rssi=e.rssi;
   if(arrived&&oled.ready&&active.load())queueSound(Audio::NEARBY,e.tag); // discovery is NOT a verified identity
  }
  if(e.type==2){bool newlyVerified=!fresh(t,e.at);t.seen=true;t.verified=true;t.lastRadio=e.at;t.lastProof=e.at;t.rssi=e.rssi;t.valid=e.valid;t.moving=e.moving;++t.count;++view.proofs;
   if(e.valid){if(t.historyCount<20)++t.historyCount;else memmove(t.history,t.history+1,19);t.history[t.historyCount-1]=std::min(9,int(e.norm/100));}
   String digest=Security::hex(e.digest,8);snprintf(view.digest,sizeof(view.digest),"%s",digest.c_str());if(!((view.event==3||view.event==4||view.event==5||view.event==6||view.event==7||view.event==8)&&uint32_t(now-view.eventAt)<2200)){view.event=1;view.eventTag=e.tag;view.eventAt=now;}if(newlyVerified&&oled.ready&&active.load())queueSound(Audio::VERIFIED,e.tag);
  }else if(e.type==3){++view.errors;view.event=2;view.eventTag=e.tag;view.eventAt=now;errorUntil=now+2000;}
  else if(e.type==5){
   t.buttonCount=e.buttonCount;t.buttonHeld=e.buttonHeld;t.buttonKnown=true;
   if(e.buttonDelta){view.event=3;view.eventTag=e.tag;view.eventAt=now;if(oled.ready&&active.load())queueSound(Audio::VERIFIED,e.tag);}
  }
 }
 bool availabilityUrgent=false;
 for(unsigned tag=0;tag<2;++tag){auto state=fastAvailability(tag,millis());auto&t=view.tags[tag];
  if(state.tracked&&(state.online||!fastSlots[tag].live.load()||t.linkKnown||state.known))availabilityUrgent|=applyAvailability(view,tag,state.online,state.known,state.on,millis());
  if(state.online&&(!state.known||state.on)){t.seen=true;t.verified=true;t.lastRadio=millis();t.lastProof=millis();}
 }
 bool inputUrgent=false;InputUi input;
 while(fastInputUi&&xQueueReceive(fastInputUi,&input,0)==pdTRUE){
  if(input.tag>=2||!fastSlots[input.tag].live.load()||input.generation!=fastSlots[input.tag].generation.load())continue;
  bool pressed=applyInput(view,input.tag,input.generation,input.count,input.held,input.at,millis());inputUrgent|=pressed;
 }
 FastUi update;while(fastUi&&xQueueReceive(fastUi,&update,0)==pdTRUE){if(update.kind==4){view.sold=false;}else if(update.kind==3){view.sold=true;view.winner=update.tag;view.hammerPrice=update.price;}else if((update.tag<1||update.tag>2||!view.tags[update.tag-1].inputKnown||update.count>=view.tags[update.tag-1].inputCount)&&(update.tag<1||update.tag>2||tagPresent(view.tags[update.tag-1]))){view.event=update.kind==1?4:5;view.eventTag=update.tag;view.eventAt=millis();if(update.tag>=1&&update.tag<=2)view.tags[update.tag-1].buttonCount=update.count;}}
 now=millis(); // UI events above carry current timestamps; do not render with the old loop time.
 if(roomVersion.load()!=Fast::MISSING)snprintf(view.phase,sizeof(view.phase),"%s",roomPhase.load()==Fast::PAUSED?"PAUSED":roomPhase.load()==Fast::COUNTDOWN?"COUNTDOWN":roomPhase.load()==Fast::OPEN?"OPEN":roomPhase.load()==Fast::CLOSED?"CLOSED":"LOBBY");
 if(oled.ready&&((inputUrgent||availabilityUrgent)||(oled.canQueue()&&uint32_t(now-lastFrame)>=1000/Config::DISPLAY_FPS))){lastFrame=now;
  drawVisual(oled.screen,view,now,now-powerAt,Config::DISPLAY_LOCATION);oled.queueFrame(inputUrgent||availabilityUrgent);}
 if(!oled.service()){fxPowered.store(false);stopBeep();Serial.println("OLED I2C lost: recovering display; BLE discovery continues.");}

 fxPowered.store(oled.ready);fxFatal.store(view.fatal);fxActive.store(active.load());unsigned freshCount=0;bool sensorWarn=false;for(auto&t:view.tags)if(fresh(t,millis())){++freshCount;if(!t.valid)sensorWarn=true;}fxFresh.store(freshCount);fxSensorWarning.store(sensorWarn);
 if(!fastFeature.load()){sound.activeModule=fxActiveModule.load();sound.activeLow=fxActiveLow.load();sound.tick(millis(),oled.ready&&!view.fatal);}
 if(ledsReady&&!fastFeature.load()){unsigned freshTags=0;bool warning=false;
  for(auto&t:view.tags)if(fresh(t,now)){++freshTags;if(!t.valid)warning=true;}
  auto duty=RuntimePolicy::leds(now,oled.ready,view.fatal,active.load(),freshTags,warning,
   errorUntil&&int32_t(errorUntil-now)>0,Config::GREEN_DUTY_MAX,Config::RED_DUTY_MAX);
  if(sound.sounding()&&!view.fatal)duty.green=Config::GREEN_DUTY_MAX;
  ledcWrite(Config::GREEN_PIN,duty.green);ledcWrite(Config::RED_PIN,duty.red);
 }
 char cmd=0;
 auto getCommand=[&](){if(fastFeature.load())return xQueueReceive(fastLegacy,&cmd,0)==pdTRUE;if(Serial.available()){cmd=Serial.read();return true;}return false;};
 for(unsigned commands=0;commands<8&&getCommand();++commands){if(cmd=='d'||cmd=='D'){stopBeep();oled.sh1106=!oled.sh1106;oled.reset();
   Preferences ui;if(ui.begin("bt-ui",false)){ui.putBool("sh1106",oled.sh1106);ui.end();}Serial.println("OLED driver changed; display recovering; BLE continues.");
  }else if(cmd=='p'||cmd=='P'){if(securityReady.load())Security::printPublic();else Serial.println("Gateway identity still initializing.");}
  else if(cmd=='m'||cmd=='M'){stopBeep();fxActiveModule.store(!fxActiveModule.load());saveAudio();printAudio();beep();}
  else if(cmd=='i'||cmd=='I'){stopBeep();fxActiveLow.store(!fxActiveLow.load());saveAudio();printAudio();beep();}
  else if(cmd=='s'||cmd=='S'){Serial.printf("STATUS OLED=%s BLE=%u proofs=%lu rejects=%lu heap=%lu\n",oled.ready?"ACK":"OFF/FAULT",active.load(),(unsigned long)view.proofs,(unsigned long)view.errors,(unsigned long)ESP.getFreeHeap());Serial.printf("SCAN running=%u starts=%lu worker_age_ms=%lu oled_frames=%lu bus_recoveries=%lu\n",scanRunning.load(),(unsigned long)scanRestarts.load(),(unsigned long)(millis()-workerAt.load()),(unsigned long)oled.frames,(unsigned long)oled.recoveries);printAudio();}
  else if(cmd=='b'||cmd=='B'){if(oled.ready&&!view.fatal)beep();else Serial.println("AUDIO paused: switch ON and OLED must respond first.");}}
 if(now-lastSerial>=10000){lastSerial=now;Serial.printf("HEARTBEAT OLED=%s proofs=%lu rejects=%lu; configured checkpoint=%s\n",oled.ready?"ACK":"OFF/FAULT",(unsigned long)view.proofs,(unsigned long)view.errors,Config::CHECKPOINT_ID);}
 delay(1);
}
}
