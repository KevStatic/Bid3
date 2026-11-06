#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <esp_random.h>
#include <bootloader_random.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/sha256.h>
#include <mbedtls/platform_util.h>
#include "Config.h"
#include "TagWire.h"
namespace Security {
constexpr char TAG_DOMAIN[]="BagTrail.TagProof.v1",SCAN_DOMAIN[]="BagTrail.GatewayScan.v1";
struct Enrollment {uint8_t device[6],pub[65],finger[32];mbedtls_ecp_keypair key;};
Enrollment tags[2];mbedtls_ecp_keypair own;mbedtls_ctr_drbg_context rng;
uint8_t gateway[16],publicKey[65],fingerprint[32],boot[8],checkpoint[32];uint32_t sequence=0;
void put16(uint8_t*p,uint16_t x){p[0]=x;p[1]=x>>8;}
void put32(uint8_t*p,uint32_t x){for(int i=0;i<4;++i)p[i]=x>>(8*i);}
uint16_t get16(const uint8_t*p){return p[0]|uint16_t(p[1])<<8;}
uint32_t get32(const uint8_t*p){return p[0]|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
int nibble(char x){if(x>='0'&&x<='9')return x-'0';if(x>='a'&&x<='f')return x-'a'+10;if(x>='A'&&x<='F')return x-'A'+10;return -1;}
bool unhex(const char*s,uint8_t*out,size_t n){if(strlen(s)!=2*n)return false;for(size_t i=0;i<n;++i){int a=nibble(s[2*i]),b=nibble(s[2*i+1]);if(a<0||b<0)return false;out[i]=a*16+b;}return true;}
String hex(const uint8_t*p,size_t n){String s;s.reserve(n*2);const char*h="0123456789abcdef";for(size_t i=0;i<n;++i){s+=h[p[i]>>4];s+=h[p[i]&15];}return s;}
int entropy(void*,unsigned char*out,size_t n){esp_fill_random(out,n);return 0;}
bool hash(const uint8_t*p,size_t n,uint8_t*out){return mbedtls_sha256(p,n,out,0)==0;}
bool taggedHash(const char*domain,const uint8_t*p,size_t n,uint8_t*out){
 uint8_t message[320];size_t d=strlen(domain);if(d+n>sizeof(message))return false;memcpy(message,domain,d);memcpy(message+d,p,n);return hash(message,d+n,out);}
bool verifySignature(mbedtls_ecp_keypair&key,const uint8_t digest[32],const uint8_t sig[64]){
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);auto&g=key.MBEDTLS_PRIVATE(grp);
 int rc=mbedtls_mpi_read_binary(&r,sig,32);if(!rc)rc=mbedtls_mpi_read_binary(&s,sig+32,32);
 if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);
 bool bounds=!rc&&mbedtls_mpi_cmp_int(&r,0)>0&&mbedtls_mpi_cmp_mpi(&r,&g.N)<0&&mbedtls_mpi_cmp_int(&s,0)>0&&mbedtls_mpi_cmp_mpi(&s,&half)<=0;
 bool valid=bounds&&mbedtls_ecdsa_verify(&g,digest,32,&key.MBEDTLS_PRIVATE(Q),&r,&s)==0;
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return valid;}
bool sign(const uint8_t digest[32],uint8_t sig[64]){
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);auto&g=own.MBEDTLS_PRIVATE(grp);
 int rc=mbedtls_ecdsa_sign_det_ext(&g,&r,&s,&own.MBEDTLS_PRIVATE(d),digest,32,MBEDTLS_MD_SHA256,mbedtls_ctr_drbg_random,&rng);
 if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);
 if(!rc&&mbedtls_mpi_cmp_mpi(&s,&half)>0)rc=mbedtls_mpi_sub_mpi(&s,&g.N,&s);
 if(!rc)rc=mbedtls_mpi_write_binary(&r,sig,32);if(!rc)rc=mbedtls_mpi_write_binary(&s,sig+32,32);
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return !rc&&verifySignature(own,digest,sig);}
bool init(){
 for(int i=0;i<2;++i){auto&t=tags[i];mbedtls_ecp_keypair_init(&t.key);uint8_t f[32];
  if(!unhex(Config::DEVICE_HEX[i],t.device,6)||!unhex(Config::PUBLIC_HEX[i],t.pub,65)||!unhex(Config::FINGERPRINT_HEX[i],t.finger,32)||!hash(t.pub,65,f)||memcmp(f,t.finger,32))return false;
  if(mbedtls_ecp_group_load(&t.key.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1)||mbedtls_ecp_point_read_binary(&t.key.MBEDTLS_PRIVATE(grp),&t.key.MBEDTLS_PRIVATE(Q),t.pub,65)||mbedtls_ecp_check_pubkey(&t.key.MBEDTLS_PRIVATE(grp),&t.key.MBEDTLS_PRIVATE(Q)))return false;
 }
 mbedtls_ecp_keypair_init(&own);mbedtls_ctr_drbg_init(&rng);bootloader_random_enable();
 int rc=mbedtls_ctr_drbg_seed(&rng,entropy,nullptr,(const uint8_t*)SCAN_DOMAIN,strlen(SCAN_DOMAIN));bootloader_random_disable();if(rc)return false;
 Preferences nvs;if(!nvs.begin("bt-gateway-v1",false))return false;uint8_t secret[32]={0};bool ok=false;
 size_t size=nvs.getBytesLength("key");
 if(size==32&&nvs.getBytesLength("uuid")==16){
  ok=nvs.getBytes("key",secret,32)==32&&nvs.getBytes("uuid",gateway,16)==16;
  rc=mbedtls_ecp_group_load(&own.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1);
  if(ok&&!rc)rc=mbedtls_mpi_read_binary(&own.MBEDTLS_PRIVATE(d),secret,32);
  if(ok&&!rc)rc=mbedtls_ecp_check_privkey(&own.MBEDTLS_PRIVATE(grp),&own.MBEDTLS_PRIVATE(d));
  if(ok&&!rc)rc=mbedtls_ecp_mul(&own.MBEDTLS_PRIVATE(grp),&own.MBEDTLS_PRIVATE(Q),&own.MBEDTLS_PRIVATE(d),&own.MBEDTLS_PRIVATE(grp).G,mbedtls_ctr_drbg_random,&rng);ok=ok&&!rc;
 }else if(!size&&!nvs.getBytesLength("uuid")){
  rc=mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256K1,&own,mbedtls_ctr_drbg_random,&rng);
  if(!rc)rc=mbedtls_mpi_write_binary(&own.MBEDTLS_PRIVATE(d),secret,32);
  if(!rc)rc=mbedtls_ctr_drbg_random(&rng,gateway,16);gateway[6]=(gateway[6]&15)|64;gateway[8]=(gateway[8]&63)|128;
  ok=!rc&&nvs.putBytes("key",secret,32)==32&&nvs.putBytes("uuid",gateway,16)==16;
  uint8_t check[32],uuidCheck[16];ok=ok&&nvs.getBytes("key",check,32)==32&&nvs.getBytes("uuid",uuidCheck,16)==16&&!memcmp(check,secret,32)&&!memcmp(uuidCheck,gateway,16);mbedtls_platform_zeroize(check,32);
 }nvs.end();mbedtls_platform_zeroize(secret,32);if(!ok)return false;
 size_t len=0;if(mbedtls_ecp_point_write_binary(&own.MBEDTLS_PRIVATE(grp),&own.MBEDTLS_PRIVATE(Q),MBEDTLS_ECP_PF_UNCOMPRESSED,&len,publicKey,65)||len!=65||!hash(publicKey,65,fingerprint))return false;
 if(mbedtls_ctr_drbg_random(&rng,boot,8)||!hash((const uint8_t*)Config::CHECKPOINT_ID,strlen(Config::CHECKPOINT_ID),checkpoint))return false;
 uint8_t digest[32],sig[64];hash((const uint8_t*)SCAN_DOMAIN,strlen(SCAN_DOMAIN),digest);return sign(digest,sig);
}
void printPublic(){Serial.println("GATEWAY_UUID_HEX="+hex(gateway,16));Serial.println("GATEWAY_PUBLIC_KEY_SECP256K1="+hex(publicKey,65));Serial.println("GATEWAY_PUBLIC_KEY_SHA256="+hex(fingerprint,32));Serial.printf("CHECKPOINT_ID=%s (configured room binding)\n",Config::CHECKPOINT_ID);}
bool makeChallenge(uint8_t r[84]){memcpy(r,"BTQ1",4);memcpy(r+4,gateway,16);memcpy(r+20,checkpoint,32);return mbedtls_ctr_drbg_random(&rng,r+52,32)==0;}
bool infoMatches(const uint8_t*p,size_t n,int tag){return tag>=0&&tag<2&&n==108&&!memcmp(p,"BTI1",4)&&p[4]==tag+1&&!memcmp(p+5,tags[tag].device,6)&&!memcmp(p+11,tags[tag].pub,65)&&!memcmp(p+76,tags[tag].finger,32);}
bool verifyAgainst(const uint8_t*p,size_t n,int tag,Enrollment&enrolled,const uint8_t request[84],bool&pending,uint32_t age,uint8_t digest[32]){
 if(!TagWire::fieldsMatch(p,n,tag,enrolled.device,request,pending,age))return false;
 if(!taggedHash(TAG_DOMAIN,p,126,digest)||!verifySignature(enrolled.key,digest,p+126))return false;pending=false;return true;
}
bool verifyProof(const uint8_t*p,size_t n,int tag,const uint8_t request[84],bool&pending,uint32_t age,uint8_t digest[32]){
 if(tag<0||tag>1)return false;return verifyAgainst(p,n,tag,tags[tag],request,pending,age,digest);
}
bool scanEnvelope(const uint8_t proof[190],int rssi,uint32_t observedAt,uint8_t out[328],uint8_t digest[32]){
 if(sequence==UINT32_MAX)return false;memset(out,0,328);memcpy(out,"BTGW",4);out[4]=1;out[5]=proof[5];out[6]=proof[6];
 memcpy(out+8,gateway,16);memcpy(out+24,checkpoint,32);memcpy(out+56,boot,8);put32(out+64,++sequence);put32(out+68,observedAt);put16(out+72,uint16_t(int16_t(rssi)));memcpy(out+74,proof,190);
 return taggedHash(SCAN_DOMAIN,out,264,digest)&&sign(digest,out+264);
}
}
