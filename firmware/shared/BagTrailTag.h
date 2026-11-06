#pragma once
// BagTrail button firmware v1: original identity/NVS and legacy proof v1 retained.
// Added D2/GPIO4 sampled button and separate signed button proof protocol.
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
void fastSample(const ButtonInput::Snapshot&,bool,uint32_t);
void buttonTask(void*){
  for(;;){
    const bool held=digitalRead(BUTTON)==LOW;const uint32_t now=millis();
    portENTER_CRITICAL(&buttonLock);buttonInput.sample(held,now);auto b=buttonInput.snapshot();portEXIT_CRITICAL(&buttonLock);
    fastSample(b,held,now);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
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
bool fastIsActive();
void checkSwitch() { if(!fastIsActive()&&digitalRead(SWITCH)==HIGH&&!switchOnStable()) standby(); }
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
#include "FastTag.h"
namespace BagTrail {
bool fastIsActive(){return fastActive.load();}
void resultStatus(uint8_t marker,uint8_t code=0) {
  uint8_t v[2]={marker,code}; responseChar->setValue(v,2);
}
class ChallengeCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String data=characteristic->getValue();
    if(data.length()!=REQUEST_SIZE) { resultStatus('E',1); return; }
    if(memcmp(data.c_str(),"BTQ1",4)&&memcmp(data.c_str(),"BTB1",4)) { resultStatus('E',2); return; }
    if(digitalRead(SWITCH)!=LOW||!connected.load()) { resultStatus('E',6); return; }
    bool nonzero=false;
    for(size_t i=52;i<84;++i) nonzero|=uint8_t(data[i])!=0;
    if(!nonzero) { resultStatus('E',2); return; }
    Request request; request.epoch=epoch.load(); memcpy(request.bytes,data.c_str(),REQUEST_SIZE);
    resultStatus('B');
    if(xQueueSend(requests,&request,0)!=pdTRUE) resultStatus('E',3);
  }
};
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    epoch.fetch_add(1); connected.store(true); connectedSince.store(millis());
  }
  void onDisconnect(BLEServer *) override {
    epoch.fetch_add(1);connected.store(false);restartAdvertising.store(true);
  }
};
void publishTelemetry() {
  uint8_t t[28]={0}; memcpy(t,"BTM1",4);t[4]=TAG;t[5]=flags();
  u32(t+8,millis());u16(t+12,sampleAge());values(t+14);
  telemetryChar->setValue(t,sizeof(t));
}
bool startBle() {
  char name[20];snprintf(name,sizeof(name),"BagTrail-Tag%02u",TAG);
  BLEDevice::init(name); BLEDevice::setMTU(247);
  server=BLEDevice::createServer(); if(!server) return false;
  server->setCallbacks(new ServerCallbacks());
  BLEService *service=server->createService(SERVICE); if(!service) return false;
  infoChar=service->createCharacteristic(INFO,BLECharacteristic::PROPERTY_READ);
  telemetryChar=service->createCharacteristic(TELEMETRY,BLECharacteristic::PROPERTY_READ);
  BLECharacteristic *challenge=service->createCharacteristic(CHALLENGE,BLECharacteristic::PROPERTY_WRITE);
  responseChar=service->createCharacteristic(RESPONSE,BLECharacteristic::PROPERTY_READ);
  if(!infoChar||!telemetryChar||!challenge||!responseChar) return false;
  if(fastCapable)fastCreate(service);
  uint8_t info[108];memcpy(info,"BTI1",4);info[4]=TAG;memcpy(info+5,deviceId,6);
  memcpy(info+11,publicKey,65);memcpy(info+76,fingerprint,32);infoChar->setValue(info,sizeof(info));
  challenge->setCallbacks(new ChallengeCallbacks());resultStatus('I');publishTelemetry();service->start();
  advertiser=BLEDevice::getAdvertising();
  BLEAdvertisementData adv,scan;
  adv.setFlags(0x06);adv.setCompleteServices(BLEUUID(SERVICE));
  const uint8_t m[]={0xFF,0xFF,'B','T',1,TAG}; // development manufacturer ID only
  adv.setManufacturerData(String(reinterpret_cast<const char *>(m),sizeof(m)));
  scan.setName(name);advertiser->setScanResponse(true);
  advertiser->setMinInterval(0x0050);advertiser->setMaxInterval(0x0078); // 50-75 ms; payload and service unchanged
  if(adv.getPayload().length()>31||scan.getPayload().length()>31) return false;
  if(!advertiser->setAdvertisementData(adv)||!advertiser->setScanResponseData(scan)) return false;
  bleStarted=true;checkSwitch();advertised=advertiser->start();
  Serial.printf("BLE %s | %s | service=%s\n",name,advertised?"START ACCEPTED":"START FAILED",SERVICE);
  return advertised;
}
void processRequest() {
  Request r;
  if(xQueueReceive(requests,&r,0)!=pdTRUE) return;
  if(r.epoch!=epoch.load()||!connected.load()) return;
  checkSwitch();
  if(signedBefore&&millis()-lastSign<SIGN_INTERVAL_MS) { resultStatus('E',4);return; }
  if(havePreviousNonce&&!memcmp(previousNonce,r.bytes+52,32)) { resultStatus('E',7);return; }
  if(sequence==UINT32_MAX) { resultStatus('E',5);fatal=true;return; }
  const bool buttonMode=!memcmp(r.bytes,"BTB1",4);
  const auto button=buttonSnapshot();
  if(buttonMode&&button.overflow){resultStatus('E',8);return;}
  const size_t bodySize=buttonMode?BUTTON_BODY_SIZE:BODY_SIZE;
  const size_t proofSize=buttonMode?BUTTON_PROOF_SIZE:PROOF_SIZE;
  const char*domain=buttonMode?BUTTON_DOMAIN:DOMAIN;
  uint8_t proof[BUTTON_PROOF_SIZE]={0};memcpy(proof,buttonMode?"BTP1":"BTAG",4);proof[4]=1;proof[5]=TAG;proof[6]=flags();
  memcpy(proof+8,deviceId,6);memcpy(proof+14,bootId,8);u32(proof+22,++sequence);
  u32(proof+26,millis());u16(proof+30,sampleAge());values(proof+32);
  memcpy(proof+46,r.bytes+4,16);memcpy(proof+62,r.bytes+20,32);memcpy(proof+94,r.bytes+52,32);
  if(buttonMode){u32(proof+126,button.count);u32(proof+130,button.lastPressAt);proof[134]=button.pressed?1:0;}
  uint8_t message[sizeof(BUTTON_DOMAIN)-1+BUTTON_BODY_SIZE],hash[32];
  const size_t domainSize=strlen(domain),messageSize=domainSize+bodySize;
  memcpy(message,domain,domainSize);memcpy(message+domainSize,proof,bodySize);
  signedBefore=true;lastSign=millis(); // also rate-limit failing crypto attempts
  const bool ok=!mbedtls_sha256(message,messageSize,hash,0)&&signDigest(hash,proof+bodySize);
  checkSwitch();
  if(r.epoch!=epoch.load()||!connected.load()) return;
  if(!ok) { resultStatus('E',5);Serial.println("ERROR: tag proof signing/self-verification failed.");return; }
  memcpy(previousNonce,r.bytes+52,32);havePreviousNonce=true;
  responseChar->setValue(proof,proofSize);
  if(buttonMode)fastPrepare(proof);
  Serial.printf("SIGNED_PROOF tag=%u seq=%lu motion_valid=%u moving=%u button_proof=%u\n",TAG,
      (unsigned long)sequence,bool(proof[6]&1),bool(proof[6]&2),buttonMode);
  if(buttonMode)Serial.printf("SIGNED_BUTTON tag=%u count=%lu held=%u\n",TAG,(unsigned long)button.count,button.pressed);
}
void setupTag() {
  gpio_deep_sleep_hold_dis();gpio_hold_dis(GPIO_NUM_5);
  digitalWrite(LED,LOW);pinMode(LED,OUTPUT);pinMode(SWITCH,INPUT_PULLUP);pinMode(BUTTON,INPUT_PULLUP);
  Serial.begin(115200);Wire.begin(SDA,SCL,100000);Wire.setTimeOut(20);delay(20);
  if(!switchOnStable()) standby();
  ledPwmReady=ledcAttach(LED,LED_PWM_HZ,8);
  if(ledPwmReady) ledcWrite(LED,LED_DUTY);
  else {fatal=true;Serial.println("FATAL: LED PWM setup failed; indicator remains OFF.");return;}
  Serial.printf("\nBid3 TAG%02u / V5 LIVE_INPUT / D2=GPIO4 to GND / static dim LED / 115200 baud\n",TAG);
  Serial.println("D2 uses INPUT_PULLUP: released=HIGH, pressed=LOW; 30 ms debounce; one count per press.");
  if(xTaskCreate(buttonTask,"button-input",4096,nullptr,2,nullptr)!=pdPASS){
    fatal=true;Serial.println("FATAL: button sampler task creation failed. BLE not started.");return;
  }
  Serial.printf("External green PWM duty: %u/255 (~15%%), 5 kHz.\n",LED_DUTY);
  requests=xQueueCreate(1,sizeof(Request));
  if(!requests||esp_read_mac(deviceId,ESP_MAC_WIFI_STA)!=ESP_OK||!initializeIdentity()) {
    fatal=true;Serial.println("FATAL: identity storage/crypto initialization failed. BLE not started.");return;
  }
  printIdentity();fastInit();checkSwitch();configureSensor();if(sensorConfigured) readMotion();checkSwitch();
  if(!startBle()) {fatal=true;Serial.println("FATAL: BLE setup failed. Move OFF/ON to retry.");}
}
void loopTag() {
  checkSwitch();uint32_t now=millis();
  if(fatal) {indicator(digitalRead(SWITCH)==LOW);delay(5);return;}
  static uint32_t reportedCount=0;static bool reportedHeld=false,reportedOverflow=false;
  const auto button=buttonSnapshot();
  if(button.count!=reportedCount||button.pressed!=reportedHeld||button.overflow!=reportedOverflow){
    reportedCount=button.count;reportedHeld=button.pressed;reportedOverflow=button.overflow;
    Serial.printf("BUTTON_LOCAL tag=%u count=%lu held=%u overflow=%u\n",TAG,(unsigned long)button.count,button.pressed,button.overflow);
  }
  processRequest();fastTick(); // Handle live radio before optional sensor work.
  if(now-lastSample>=20) {lastSample=now;if(sensorConfigured) readMotion();}
  if(!sensorConfigured&&!connected.load()&&now-lastRetry>=5000) {lastRetry=now;configureSensor();}
  if(restartAdvertising.exchange(false)) {advertised=false;lastAdvertise=0;}
  if(!connected.load()&&!advertised&&now-lastAdvertise>=1000) {
    lastAdvertise=now;advertised=advertiser->start();
  }
  if(connected.load()&&!fastActive.load()&&now-connectedSince.load()>SESSION_MS) server->disconnect(server->getConnId());
  if(now-lastTelemetry>=200) {lastTelemetry=now;publishTelemetry();}
  indicator(digitalRead(SWITCH)==LOW);
  if(now-lastLog>=2000) {
    lastLog=now;Serial.printf("TAG%02u %s | BLE=%s | sensor=%s | moving=%u | accel_mg=%d,%d,%d | seq=%lu\n",
      TAG,digitalRead(SWITCH)==LOW?"ON":"OFF",connected.load()?"CONNECTED":advertised?"ADVERTISING":"RETRY",
      flags()&1?"VALID":"INVALID",bool(flags()&2),sample.ax,sample.ay,sample.az,(unsigned long)sequence);
  }
  while(Serial.available()) {char cmd=Serial.read();if(cmd=='p'||cmd=='P') printIdentity();}
  delay(2);
}
} // namespace BagTrail
