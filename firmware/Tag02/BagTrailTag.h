#pragma once
// Bid3 auction firmware: original identity/NVS and pin wiring retained.
// New session-bound individual signed intents; legacy snapshot service is superseded.
#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEAdvertising.h>
#include <esp_sleep.h>
#include <esp_system.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <bootloader_random.h>
#include <driver/gpio.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/sha256.h>
#include <mbedtls/platform_util.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <atomic>
#include <freertos/task.h>
#include "ButtonInput.h"
#include <math.h>

#if !defined(CONFIG_IDF_TARGET_ESP32C3)
#error "Select XIAO_ESP32C3 for this tag firmware."
#endif
#if !CONFIG_ESP_SLEEP_GPIO_ENABLE_INTERNAL_RESISTORS
#error "Internal sleep wake-up pull resistors must be enabled."
#endif
#if BAGTRAIL_TAG_NUMBER != 1 && BAGTRAIL_TAG_NUMBER != 2
#error "Use the supplied Tag01 or Tag02 sketch."
#endif

namespace BagTrail {
constexpr uint8_t TAG = BAGTRAIL_TAG_NUMBER;
constexpr uint8_t LED = 5, SWITCH = 3, BUTTON = 4, SDA = 6, SCL = 7; // XIAO D2 = GPIO4
constexpr uint8_t LED_DUTY = 38; // 38/255 = ~15% PWM duty for external green LED
constexpr uint32_t LED_PWM_HZ = 5000;
bool ledPwmReady = false;
void indicator(bool on) {
  if(ledPwmReady) ledcWrite(LED,on ? LED_DUTY : 0);
}
void releaseLedForSleep() {
  if(ledPwmReady) {
    ledcWrite(LED,0);
    ledcDetach(LED);
    ledPwmReady=false;
  }
  pinMode(LED,OUTPUT);
  digitalWrite(LED,LOW); // GPIO is explicitly LOW before enabling sleep hold
}
constexpr char SERVICE[] = "b7610001-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char INFO[] = "b7610002-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char TELEMETRY[] = "b7610003-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char CHALLENGE[] = "b7610004-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char RESPONSE[] = "b7610005-7e1d-4e8b-9a73-8f1b0c4d9000";
constexpr char DOMAIN[] = "BagTrail.TagProof.v1";
constexpr char BUTTON_DOMAIN[] = "BagTrail.ButtonProof.v1";
constexpr size_t BUTTON_BODY_SIZE=135, BUTTON_PROOF_SIZE=199;
ButtonInput::Debouncer buttonInput;
portMUX_TYPE buttonLock=portMUX_INITIALIZER_UNLOCKED;
ButtonInput::Snapshot buttonSnapshot(){
  portENTER_CRITICAL(&buttonLock);
  auto result=buttonInput.snapshot();
  portEXIT_CRITICAL(&buttonLock);return result;
}
constexpr size_t REQUEST_SIZE = 84, BODY_SIZE = 126, PROOF_SIZE = 190;
constexpr uint32_t SIGN_INTERVAL_MS = 1500, SESSION_MS = 10000;
struct Request { uint32_t epoch; uint8_t bytes[REQUEST_SIZE]; };
struct Sample {
  int16_t ax = INT16_MIN, ay = INT16_MIN, az = INT16_MIN;
  int16_t gx = INT16_MIN, gy = INT16_MIN, gz = INT16_MIN, temp = INT16_MIN;
  uint32_t at = 0;
  bool valid = false;
} sample;

BLEServer *server = nullptr;
BLEAdvertising *advertiser = nullptr;
BLECharacteristic *infoChar = nullptr, *telemetryChar = nullptr, *responseChar = nullptr;
QueueHandle_t requests = nullptr;
std::atomic<bool> connected(false), restartAdvertising(false);
std::atomic<uint32_t> epoch(0), connectedSince(0);
bool bleStarted = false, advertised = false, fatal = false, sensorConfigured = false;
uint8_t sensorAddress = 0, deviceId[6], bootId[8], publicKey[65], fingerprint[32];
uint8_t previousNonce[32];
bool havePreviousNonce = false, haveMotion = false, signedBefore = false;
uint32_t sequence = 0, lastSign = 0, lastSample = 0, lastMotion = 0;
uint32_t lastRetry = 0, lastTelemetry = 0, lastLog = 0, lastAdvertise = 0;
mbedtls_ecdsa_context key;
mbedtls_ctr_drbg_context drbg;

void u16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
void u32(uint8_t *p, uint32_t v) { for (int i=0;i<4;++i) p[i]=v>>(8*i); }
int16_t bounded(float v) { return int16_t(constrain(v, -32767.0f, 32767.0f)); }
uint16_t sampleAge() {
  const uint32_t age=millis()-sample.at;
  return sample.valid&&age<=1000 ? uint16_t(age) : 65535;
}
uint8_t flags() {
  const bool valid = sample.valid && sampleAge() <= 1000;
  return (valid ? 1 : 0) | (valid && haveMotion && millis()-lastMotion<2000 ? 2 : 0)
         | (sensorAddress==0x69 ? 4 : 0);
}
void values(uint8_t *p) {
  const int16_t v[] = {sample.ax,sample.ay,sample.az,sample.gx,sample.gy,sample.gz,sample.temp};
  for (int i=0;i<7;++i) u16(p+2*i,flags()&1 ? uint16_t(v[i]) : uint16_t(INT16_MIN));
}
bool switchOnStable() {
  int old = digitalRead(SWITCH); uint32_t since=millis(), start=since;
  while (millis()-start<250) {
    int level=digitalRead(SWITCH);
    if (level!=old) { old=level; since=millis(); }
    if (millis()-since>=50) return level==LOW;
    delay(2);
  }
  return false;
}
bool readBytes(uint8_t address,uint8_t reg,uint8_t *data,size_t n) {
  Wire.beginTransmission(address); Wire.write(reg);
  if (Wire.endTransmission(false)!=0) return false;
  if (Wire.requestFrom(address,n,true)!=n) { while(Wire.available()) Wire.read(); return false; }
  for(size_t i=0;i<n;++i) data[i]=Wire.read();
  return true;
}
bool regWrite(uint8_t address,uint8_t reg,uint8_t v) {
  Wire.beginTransmission(address); Wire.write(reg); Wire.write(v);
  return Wire.endTransmission()==0;
}
bool sensorSleep() {
  for (uint8_t a : {uint8_t(0x68),uint8_t(0x69)}) {
    uint8_t id=0,power=0,check=0;
    if (!readBytes(a,0x75,&id,1)||id!=0x68||!readBytes(a,0x6B,&power,1)) continue;
    if (regWrite(a,0x6B,power|0x40)&&readBytes(a,0x6B,&check,1)&&(check&0x40)) return true;
  }
  return false;
}
void standby() {
  releaseLedForSleep();
  epoch.fetch_add(1);
  if (bleStarted) { advertiser->stop(); BLEDevice::deinit(false); bleStarted=false; }
  if(requests) xQueueReset(requests);
  Serial.println(sensorSleep() ? "MPU6050 sleep confirmed." : "WARNING: MPU sleep not confirmed.");
  Serial.println("OFF: BLE stopped, external green OFF, entering standby. MPU power LED may remain lit.");
  if (esp_deep_sleep_enable_gpio_wakeup(1ULL<<SWITCH,ESP_GPIO_WAKEUP_GPIO_LOW)!=ESP_OK) {
    Serial.println("Wake setup failed; waiting safely for ON, then restarting.");
    while(!switchOnStable()) delay(20);
    esp_restart();
  }
  gpio_pullup_en(GPIO_NUM_3); gpio_pulldown_dis(GPIO_NUM_3);
  gpio_hold_en(GPIO_NUM_5); gpio_deep_sleep_hold_en();
  Wire.end(); Serial.flush(); delay(20); esp_deep_sleep_start();
}
void checkSwitch() {} // Bid3 OUT keeps the authenticated BLE session alive.
bool configureSensor() {
  sample.valid=false; sensorConfigured=false; sensorAddress=0;
  for(uint8_t a : {uint8_t(0x68),uint8_t(0x69)}) {
    uint8_t id=0;
    if(!readBytes(a,0x75,&id,1)||id!=0x68) continue;
    if(!regWrite(a,0x6B,0x01)) continue; // wake, gyro X PLL clock
    delay(100); checkSwitch();
    if(!regWrite(a,0x6C,0)||!regWrite(a,0x1A,4)||!regWrite(a,0x19,19)||
       !regWrite(a,0x1B,8)||!regWrite(a,0x1C,8)) continue;
    uint8_t gyro=0,accel=0;
    if(!readBytes(a,0x1B,&gyro,1)||!readBytes(a,0x1C,&accel,1)||
       (gyro&0x18)!=8||(accel&0x18)!=8) continue;
    sensorAddress=a; sensorConfigured=true;
    Serial.printf("MPU6050 ready at 0x%02X (+/-4g, +/-500 deg/s, 50 Hz).\n",a);
    return true;
  }
  Serial.println("MPU6050 unavailable: BLE identity remains available; motion marked INVALID.");
  return false;
}
void readMotion() {
  uint8_t b[14];
  if(!sensorConfigured||!readBytes(sensorAddress,0x3B,b,14)) {
    sample.valid=false; sensorConfigured=false; return;
  }
  int16_t raw[7];
  for(int i=0;i<7;++i) raw[i]=int16_t(uint16_t(b[2*i])<<8|b[2*i+1]);
  sample.ax=bounded(raw[0]*1000.0f/8192); sample.ay=bounded(raw[1]*1000.0f/8192);
  sample.az=bounded(raw[2]*1000.0f/8192); sample.temp=bounded(raw[3]*100.0f/340+3653);
  sample.gx=bounded(raw[4]*10.0f/65.5f); sample.gy=bounded(raw[5]*10.0f/65.5f);
  sample.gz=bounded(raw[6]*10.0f/65.5f); sample.at=millis(); sample.valid=true;
  float norm=sqrtf(float(sample.ax)*sample.ax+float(sample.ay)*sample.ay+float(sample.az)*sample.az);
  if(fabsf(norm-1000)>150||abs(sample.gx)>120||abs(sample.gy)>120||abs(sample.gz)>120) {
    lastMotion=millis(); haveMotion=true;
  }
}
int entropy(void *,unsigned char *out,size_t len) { esp_fill_random(out,len); return 0; }
bool signDigest(const uint8_t hash[32],uint8_t signature[64]) {
  mbedtls_mpi r,s,half; mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);
  auto &group=key.MBEDTLS_PRIVATE(grp);
  int result=mbedtls_ecdsa_sign_det_ext(&group,&r,&s,&key.MBEDTLS_PRIVATE(d),hash,32,
      MBEDTLS_MD_SHA256,mbedtls_ctr_drbg_random,&drbg);
  if(!result) result=mbedtls_mpi_copy(&half,&group.N);
  if(!result) result=mbedtls_mpi_shift_r(&half,1);
  if(!result&&mbedtls_mpi_cmp_mpi(&s,&half)>0) result=mbedtls_mpi_sub_mpi(&s,&group.N,&s);
  if(!result) result=mbedtls_ecdsa_verify(&group,hash,32,&key.MBEDTLS_PRIVATE(Q),&r,&s);
  if(!result) result=mbedtls_mpi_write_binary(&r,signature,32);
  if(!result) result=mbedtls_mpi_write_binary(&s,signature+32,32);
  mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);
  return result==0;
}
bool initializeIdentity() {
  mbedtls_ecdsa_init(&key); mbedtls_ctr_drbg_init(&drbg);
  bootloader_random_enable();
  int result=mbedtls_ctr_drbg_seed(&drbg,entropy,nullptr,
      reinterpret_cast<const uint8_t *>(DOMAIN),sizeof(DOMAIN)-1);
  bootloader_random_disable(); // must precede BLE startup
  if(result) return false;
  Preferences prefs;
  if(!prefs.begin("bagtrail-v1",false)) return false;
  uint8_t secret[32]={0}; bool ok=false;
  const size_t stored=prefs.getBytesLength("private");
  if(stored==32&&prefs.getUChar("tag",0)==TAG) {
    ok=prefs.getBytes("private",secret,32)==32;
    if(ok) result=mbedtls_ecp_group_load(&key.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1);
    if(ok&&!result) result=mbedtls_mpi_read_binary(&key.MBEDTLS_PRIVATE(d),secret,32);
    if(ok&&!result) result=mbedtls_ecp_check_privkey(&key.MBEDTLS_PRIVATE(grp),&key.MBEDTLS_PRIVATE(d));
    if(ok&&!result) result=mbedtls_ecp_mul(&key.MBEDTLS_PRIVATE(grp),&key.MBEDTLS_PRIVATE(Q),
        &key.MBEDTLS_PRIVATE(d),&key.MBEDTLS_PRIVATE(grp).G,mbedtls_ctr_drbg_random,&drbg);
    ok=ok&&!result;
  } else if(stored==0) {
    result=mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256K1,&key,mbedtls_ctr_drbg_random,&drbg);
    if(!result) result=mbedtls_mpi_write_binary(&key.MBEDTLS_PRIVATE(d),secret,32);
    ok=!result&&prefs.putUChar("tag",TAG)==1&&prefs.putBytes("private",secret,32)==32;
    uint8_t confirm[32];
    ok=ok&&prefs.getBytes("private",confirm,32)==32&&memcmp(secret,confirm,32)==0;
    mbedtls_platform_zeroize(confirm,sizeof(confirm));
  } else Serial.println("NVS identity mismatch/corruption: refusing silent key replacement.");
  prefs.end();mbedtls_platform_zeroize(secret,sizeof(secret));
  if(!ok) return false;
  size_t written=0;
  result=mbedtls_ecp_point_write_binary(&key.MBEDTLS_PRIVATE(grp),&key.MBEDTLS_PRIVATE(Q),
      MBEDTLS_ECP_PF_UNCOMPRESSED,&written,publicKey,sizeof(publicKey));
  if(result||written!=65||mbedtls_sha256(publicKey,65,fingerprint,0)) return false;
  if(mbedtls_ctr_drbg_random(&drbg,bootId,sizeof(bootId))) return false;
  uint8_t hash[32],sig[64];
  if(mbedtls_sha256(reinterpret_cast<const uint8_t *>(DOMAIN),sizeof(DOMAIN)-1,hash,0)) return false;
  return signDigest(hash,sig); // boot sign-and-verify self-test
}
void printHex(const uint8_t *p,size_t n) { for(size_t i=0;i<n;++i) Serial.printf("%02x",p[i]); }
void printIdentity() {
  Serial.printf("ENROLL_TAG=%u\nDEVICE_ID=",TAG);printHex(deviceId,6);
  Serial.print("\nPUBLIC_KEY_SECP256K1=");printHex(publicKey,65);
  Serial.print("\nPUBLIC_KEY_SHA256=");printHex(fingerprint,32);
  Serial.println("\nSave these PUBLIC enrollment fields for the gateway/backend. Private key is never printed.");
}

} // namespace BagTrail
#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>
#endif
#include <freertos/semphr.h>
#include "AuctionWire.h"
#include "AuctionInput.h"
#include "ConnectionPolicy.h"
#include "AuthorityConfig.h"
#include "AuctionCrypto.h"
namespace BagTrail {
struct Packet {uint32_t generation=0;uint16_t n=0;uint8_t bytes[Bid3::SIGNED]={0};};
QueueHandle_t controls=nullptr,intents=nullptr;
SemaphoreHandle_t notifyLock=nullptr;
BLECharacteristic *auctionEvents=nullptr;
mbedtls_ecp_keypair authority;
std::atomic<bool> sessionReady(false),sessionFault(false),admitted(false);
portMUX_TYPE contextLock=portMUX_INITIALIZER_UNLOCKED;
uint8_t context[Bid3::SIGNED]={0},sessionSecret[32]={0};
uint32_t controlSeq=0,intentSeq=0;std::atomic<uint32_t> heartbeatSeq(0);
uint32_t armedConnectionEpoch=UINT32_MAX;uint8_t usedSessions[32][16]={0};unsigned usedSessionCount=0;
std::atomic<uint32_t> controlAt(0),feedbackAt(0);
std::atomic<uint8_t> feedbackReason(Bid3::INVALID),leader(0),phase(Bid3::PAUSED);
bool authorityLoaded=false,pending=false;Packet outstanding;
uint32_t pendingAt=0,lastSend=0;char usbLine[180]={0};size_t usbUsed=0;
void invalidate(){sessionReady.store(false);admitted.store(false);sessionFault.store(true);}
bool notifyPacket(const Packet&p){
 if(!connected.load()||!auctionEvents)return false;
 if(xSemaphoreTake(notifyLock,pdMS_TO_TICKS(10))!=pdTRUE)return false;
 auctionEvents->setValue(p.bytes,p.n);auctionEvents->notify();xSemaphoreGive(notifyLock);return true;
}
void snapshotContext(uint8_t*out){portENTER_CRITICAL(&contextLock);memcpy(out,context,Bid3::SIGNED);portEXIT_CRITICAL(&contextLock);}
void makeIntent(Packet&p,Bid3::Kind kind,const uint8_t*quote,uint32_t count,uint32_t at){
 p=Packet{};p.n=Bid3::SIGNED;memcpy(p.bytes,quote,Bid3::BODY);
 p.bytes[5]=kind;p.bytes[7]=0;Bid3::put32(p.bytes+110,0);Bid3::put32(p.bytes+122,count);Bid3::put32(p.bytes+126,at);
}
void enqueueIntent(Bid3::Kind kind,const uint8_t*quote,uint32_t count,uint32_t at){
 Packet p;makeIntent(p,kind,quote,count,at);
 if(xQueueSend(intents,&p,0)!=pdTRUE)invalidate();
}
void inputTask(void*){
 Bid3::ButtonDebounce debounce(digitalRead(BUTTON)==LOW);bool oldSwitch=digitalRead(SWITCH)==LOW;
 bool switchRaw=oldSwitch;uint32_t changed=millis(),switchChanged=changed,count=0,lastBeat=0;
 bool wasReady=false;uint8_t edgeQuote[Bid3::SIGNED]={0};
 for(;;){
  uint32_t now=millis();bool ready=sessionReady.load()&&!sessionFault.load();
  bool sw=digitalRead(SWITCH)==LOW;
  if(sw!=switchRaw){switchRaw=sw;switchChanged=now;}
  if(ready&&!wasReady){uint8_t q[Bid3::SIGNED];snapshotContext(q);oldSwitch=sw;switchRaw=sw;
   enqueueIntent(sw?Bid3::JOIN:Bid3::LEAVE,q,count,now);}
  if(sw!=oldSwitch&&uint32_t(now-switchChanged)>=20){oldSwitch=sw;
   if(!sw)admitted.store(false);
   if(ready){uint8_t q[Bid3::SIGNED];snapshotContext(q);enqueueIntent(sw?Bid3::JOIN:Bid3::LEAVE,q,count,now);}}
  bool down=digitalRead(BUTTON)==LOW;
  if(down!=debounce.rawLevel()){changed=now;if(down)snapshotContext(edgeQuote);}
  if(debounce.sample(down,now)){if(count==UINT32_MAX)invalidate();else ++count;
    if(ready&&oldSwitch&&admitted.load()&&(phase.load()==Bid3::OPEN||phase.load()==Bid3::COUNTDOWN))enqueueIntent(Bid3::BID,edgeQuote,count,changed);
    else {feedbackReason.store(Bid3::NOT_ACTIVE);feedbackAt.store(now);}
   }
  if(ready&&uint32_t(now-lastBeat)>=250){lastBeat=now;Packet beat;beat.n=Bid3::MACED;snapshotContext(beat.bytes);
   beat.bytes[5]=Bid3::HEARTBEAT;beat.bytes[7]=0;
   if(heartbeatSeq==UINT32_MAX)invalidate();else{Bid3::put32(beat.bytes+110,++heartbeatSeq);Bid3::put32(beat.bytes+126,now);
    uint8_t secret[32];portENTER_CRITICAL(&contextLock);memcpy(secret,sessionSecret,32);portEXIT_CRITICAL(&contextLock);
    if(Bid3Crypto::mac(secret,beat.bytes,"Bid3.Liveness.v1"))notifyPacket(beat);else invalidate();}}
  if(ready&&uint32_t(now-controlAt.load())>2000)invalidate();
  wasReady=ready;vTaskDelay(pdMS_TO_TICKS(1));
 }
}
class AuctionControl:public BLECharacteristicCallbacks {
 void onWrite(BLECharacteristic*c)override{
  String value=c->getValue();if(value.length()!=Bid3::SIGNED&&value.length()!=Bid3::MACED)return;
  Packet p;p.generation=epoch.load();p.n=value.length();memcpy(p.bytes,value.c_str(),p.n);
  if(!Bid3::header(p.bytes,p.n))return;
  if(xQueueSend(controls,&p,0)!=pdTRUE)invalidate();
 }
};
class AuctionServer:public BLEServerCallbacks {
 void onConnect(BLEServer*)override{epoch.fetch_add(1);connected.store(true);sessionReady.store(false);sessionFault.store(false);admitted.store(false);}
 void onDisconnect(BLEServer*)override{epoch.fetch_add(1);connected.store(false);invalidate();restartAdvertising.store(true);}
};
bool loadAuthority(){
 const char*configured=Bid3Config::GATEWAY_PUBLIC_KEY_HEX;
 if(*configured){
  if(strlen(configured)!=130)return false;uint8_t pub[65];
  for(int i=0;i<65;++i){char pair[3]={configured[2*i],configured[2*i+1],0};char*end=nullptr;unsigned n=strtoul(pair,&end,16);if(end!=pair+2)return false;pub[i]=n;}
  return Bid3Crypto::loadPublic(authority,pub);
 }
 Preferences p;if(!p.begin("bid3-authority",true))return false;uint8_t pub[65];
 bool ok=p.getBytesLength("gateway")==65&&p.getBytes("gateway",pub,65)==65;p.end();
 return ok&&Bid3Crypto::loadPublic(authority,pub);
}
void usbCommand(){
 while(Serial.available()){
  char c=Serial.read();if(c=='\r')continue;
  if(c!='\n'){if(usbUsed+1<sizeof(usbLine))usbLine[usbUsed++]=c;else usbUsed=0;continue;}
  usbLine[usbUsed]=0;usbUsed=0;
  if(!strcmp(usbLine,"p")){printIdentity();continue;}
  if(!strncmp(usbLine,"GATEWAY_KEY=",12)&&strlen(usbLine+12)==130){
   if(*Bid3Config::GATEWAY_PUBLIC_KEY_HEX){Serial.println("BUILD_PIN_ACTIVE: this build already pins your gateway. Update AuthorityConfig.h to change it.");continue;}
   uint8_t pub[65];bool ok=true;
   for(int i=0;i<65;++i){char pair[3]={usbLine[12+i*2],usbLine[13+i*2],0};char*end=nullptr;
    unsigned n=strtoul(pair,&end,16);if(end!=pair+2){ok=false;break;}pub[i]=n;}
   mbedtls_ecp_keypair candidate;mbedtls_ecp_keypair_init(&candidate);ok=ok&&Bid3Crypto::loadPublic(candidate,pub);
   if(ok){Preferences p;ok=p.begin("bid3-authority",false);if(ok){ok=p.putBytes("gateway",pub,65)==65;p.end();}}
   mbedtls_ecp_keypair_free(&candidate);
   Serial.println(ok?"Gateway enrolled over USB. Restart tag to activate.":"Gateway enrollment rejected.");
  }
 }
}
void processControls(){
 if(!connected.load()){xQueueReset(controls);return;}
 Packet p;for(int i=0;i<8&&xQueueReceive(controls,&p,0)==pdTRUE;++i){
  uint8_t*b=p.bytes;if(p.generation!=epoch.load()||b[6]!=TAG||memcmp(b+8,deviceId,6)||memcmp(b+14,bootId,8))continue;
  if(b[5]==Bid3::ARM&&p.n==Bid3::SIGNED){
   // One ARM per connection. A new epoch requires an explicit disconnect/re-arm.
   if(!authorityLoaded){Serial.println("BID3_ARM_REJECT=GATEWAY_KEY_NOT_ENROLLED");continue;}
   if(armedConnectionEpoch==epoch.load()||usedSessionCount==32||sessionReady.load()||!Bid3::u32(b+110))continue;
   if(!Bid3Crypto::verify(authority,b,"Bid3.Arm.v1")){Serial.println("BID3_ARM_REJECT=GATEWAY_SIGNATURE_MISMATCH");continue;}
   bool seen=false;for(unsigned j=0;j<usedSessionCount;++j)seen|=!memcmp(usedSessions[j],b+22,16);if(seen)continue;
   uint8_t secret[32];if(!Bid3Crypto::sessionKey(key,authority,drbg,b,secret))continue;
   memcpy(usedSessions[usedSessionCount++],b+22,16);armedConnectionEpoch=epoch.load();
   xQueueReset(intents);pending=false;intentSeq=0;heartbeatSeq=0;controlSeq=Bid3::u32(b+110);
   portENTER_CRITICAL(&contextLock);memcpy(context,b,Bid3::SIGNED);memcpy(sessionSecret,secret,32);portEXIT_CRITICAL(&contextLock);
   controlAt.store(millis());sessionFault.store(false);admitted.store(false);leader.store(b[127]);phase.store(b[126]);sessionReady.store(true);
   Serial.println("BID3_SESSION_READY");continue;
  }
  if(!sessionReady.load()||p.n!=Bid3::MACED)continue;
  uint8_t q[Bid3::SIGNED];snapshotContext(q);
  if(!Bid3::bound(b,q)||!Bid3::newer(Bid3::u32(b+110),controlSeq)||!Bid3Crypto::checkMac(sessionSecret,b,"Bid3.Control.v1"))continue;
  if(b[5]!=Bid3::ACK&&b[5]!=Bid3::QUOTE&&b[5]!=Bid3::PAUSE&&b[5]!=Bid3::CLOSE)continue;
  controlSeq=Bid3::u32(b+110);controlAt.store(millis());leader.store(b[127]);phase.store(b[126]);
  portENTER_CRITICAL(&contextLock);memcpy(context,b,Bid3::BODY);portEXIT_CRITICAL(&contextLock);
  if(b[5]==Bid3::ACK&&pending&&Bid3::u32(b+122)==Bid3::u32(outstanding.bytes+110)){
   if(b[7]==Bid3::ACCEPTED){
    if(outstanding.bytes[5]==Bid3::JOIN)admitted.store(digitalRead(SWITCH)==LOW);
    if(outstanding.bytes[5]==Bid3::LEAVE)admitted.store(false);
   }
   feedbackReason.store(b[7]);feedbackAt.store(millis());pending=false;
  }
  if(b[5]==Bid3::CLOSE){admitted.store(false);}
 }
}
void setupTag(){
 gpio_deep_sleep_hold_dis();gpio_hold_dis(GPIO_NUM_5);
 pinMode(LED,OUTPUT);digitalWrite(LED,LOW);pinMode(SWITCH,INPUT_PULLUP);pinMode(BUTTON,INPUT_PULLUP);
 Serial.begin(115200);Wire.begin(SDA,SCL,100000);Wire.setTimeOut(5);
 ledPwmReady=ledcAttach(LED,LED_PWM_HZ,8);indicator(Bid3::tagLed(digitalRead(SWITCH)==LOW));mbedtls_ecp_keypair_init(&authority);
 if(!ledPwmReady||esp_read_mac(deviceId,ESP_MAC_WIFI_STA)!=ESP_OK||!initializeIdentity()){fatal=true;Serial.println("BID3_FATAL=tag_identity_or_LED_initialization");return;}
 authorityLoaded=loadAuthority();printIdentity();indicator(Bid3::tagLed(digitalRead(SWITCH)==LOW));
 Serial.println("Bid3 tag V2: static LED; D2=GPIO4 BID, D1=GPIO3 JOIN/LEAVE. No flash erase.");
 if(!authorityLoaded)Serial.println("Enroll trusted gateway over USB: GATEWAY_KEY=<130 hex chars>, then reset.");
 controls=xQueueCreate(12,sizeof(Packet));intents=xQueueCreate(8,sizeof(Packet));notifyLock=xSemaphoreCreateMutex();
 if(!controls||!intents||!notifyLock){fatal=true;Serial.println("BID3_FATAL=tag_queue_allocation");return;}
 char name[20];snprintf(name,sizeof(name),"Bid3-Tag%02u",TAG);BLEDevice::init(name);BLEDevice::setMTU(247);
 server=BLEDevice::createServer();server->setCallbacks(new AuctionServer());
 auto*service=server->createService(BLEUUID(Bid3::SERVICE),24);
 auto*info=service->createCharacteristic(Bid3::INFO,BLECharacteristic::PROPERTY_READ);
 auto*control=service->createCharacteristic(Bid3::CONTROL,BLECharacteristic::PROPERTY_WRITE);
 auctionEvents=service->createCharacteristic(Bid3::EVENTS,BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
 // NimBLE creates the notification descriptor automatically.
 auctionEvents->addDescriptor(new BLE2902());
#endif
 control->setCallbacks(new AuctionControl());
 uint8_t data[116]={0};memcpy(data,"B3I1",4);data[4]=TAG;memcpy(data+5,deviceId,6);memcpy(data+11,publicKey,65);memcpy(data+76,bootId,8);
 if(authorityLoaded){uint8_t authorityPublic[65];size_t length=0;
  if(!mbedtls_ecp_point_write_binary(&authority.MBEDTLS_PRIVATE(grp),&authority.MBEDTLS_PRIVATE(Q),MBEDTLS_ECP_PF_UNCOMPRESSED,&length,authorityPublic,sizeof(authorityPublic))&&length==65)
   mbedtls_sha256(authorityPublic,65,data+84,0);
 }
 info->setValue(data,sizeof(data));
 service->start();advertiser=BLEDevice::getAdvertising();
 BLEAdvertisementData adv,scan;adv.setFlags(0x06);adv.setCompleteServices(BLEUUID(Bid3::SERVICE));
 const uint8_t marker[]={0xff,0xff,'B','3',2,TAG};
 adv.setManufacturerData(String(reinterpret_cast<const char*>(marker),sizeof(marker)));scan.setName(name);
 if(adv.getPayload().length()>31||scan.getPayload().length()>31||!advertiser->setAdvertisementData(adv)||!advertiser->setScanResponseData(scan)){
  fatal=true;Serial.println("BID3_ADVERTISING_ERROR=payload_configuration");return;
 }
 advertiser->setMinInterval(0x30);advertiser->setMaxInterval(0x50);advertiser->setScanResponse(true);
 advertised=advertiser->start();bleStarted=true;lastAdvertise=millis();
 Serial.printf("BID3_V2_ADVERTISING tag=%u accepted=%u bytes=%u authority=%s\n",TAG,advertised,unsigned(adv.getPayload().length()),authorityLoaded?"PINNED":"NEEDS_GATEWAY_KEY");
 if(xTaskCreate(inputTask,"bid3-input",4096,nullptr,2,nullptr)!=pdPASS){fatal=true;invalidate();}
}
void loopTag(){
 indicator(Bid3::tagLed(digitalRead(SWITCH)==LOW));usbCommand();if(fatal){delay(10);return;}processControls();uint32_t now=millis();
 static bool linkReported=false;
 bool linkNow=connected.load();if(linkNow!=linkReported){linkReported=linkNow;Serial.println(linkNow?"BID3_BLE=CONNECTED; waiting for authenticated engine session":"BID3_BLE=DISCONNECTED");}
 if(restartAdvertising.exchange(false)){pending=false;xQueueReset(intents);advertised=false;lastAdvertise=0;Serial.println("BID3_BLE=DISCONNECTED; restarting advertising");}
 if(bleStarted&&!connected.load()&&!advertised&&uint32_t(now-lastAdvertise)>=1000){lastAdvertise=now;advertised=advertiser->start();}
 if(!fatal&&sessionReady.load()&&!sessionFault.load()){
  if(!pending&&xQueueReceive(intents,&outstanding,0)==pdTRUE){
   if(intentSeq==UINT32_MAX){invalidate();return;}
   Bid3::put32(outstanding.bytes+110,++intentSeq);uint32_t began=micros();
   if(!Bid3Crypto::sign(key,drbg,outstanding.bytes,"Bid3.Intent.v1")){invalidate();return;}
   uint32_t signUs=micros()-began;
   pending=true;pendingAt=millis();lastSend=pendingAt;notifyPacket(outstanding);
   Serial.printf("BID3_SIGN_US=%lu\n",(unsigned long)signUs);
  }
  now=millis();
  if(pending&&uint32_t(now-lastSend)>=200){lastSend=now;notifyPacket(outstanding);}
  if(pending&&uint32_t(now-pendingAt)>2000)invalidate();
 }
 // User-requested static status LED: switch ON only, independent of bid,
 // leader, fault, engine phase and timing. It is not an admission indicator.
 bool light=Bid3::tagLed(digitalRead(SWITCH)==LOW);
 indicator(light);delay(1);
}
} // namespace BagTrail
