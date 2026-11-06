#pragma once
#include "FastWire.h"
#include <mbedtls/ecp.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <mbedtls/platform_util.h>
namespace FastCrypto {
inline bool publicKey(mbedtls_ecp_keypair&peer,const uint8_t pub[65]){
 return !mbedtls_ecp_group_load(&peer.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1)&&!mbedtls_ecp_point_read_binary(&peer.MBEDTLS_PRIVATE(grp),&peer.MBEDTLS_PRIVATE(Q),pub,65)&&!mbedtls_ecp_check_pubkey(&peer.MBEDTLS_PRIVATE(grp),&peer.MBEDTLS_PRIVATE(Q));
}
inline bool shared(mbedtls_ecp_keypair&own,const uint8_t pub[65],mbedtls_ctr_drbg_context&rng,uint8_t*out){
 mbedtls_ecp_keypair peer;mbedtls_ecp_keypair_init(&peer);mbedtls_ecp_point point;mbedtls_ecp_point_init(&point);
 bool ok=publicKey(peer,pub)&&!mbedtls_ecp_mul(&own.MBEDTLS_PRIVATE(grp),&point,&own.MBEDTLS_PRIVATE(d),&peer.MBEDTLS_PRIVATE(Q),mbedtls_ctr_drbg_random,&rng)&&!mbedtls_mpi_write_binary(&point.MBEDTLS_PRIVATE(X),out,32);
 mbedtls_ecp_keypair_free(&peer);mbedtls_ecp_point_free(&point);return ok;
}
inline bool hmac(const uint8_t*key,size_t keySize,const uint8_t*data,size_t size,uint8_t out[32]){return !mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,keySize,data,size,out);}
inline bool key(const uint8_t sharedX[32],const uint8_t proof[199],uint8_t*out){
 uint8_t prk[32],info[64];const char*domain="Bid3.FastSession.v4";size_t d=strlen(domain);
 memcpy(info,domain,d);memcpy(info+d,proof+14,8);memcpy(info+d+8,proof+46,16);info[d+24]=1;
 bool ok=hmac(proof+94,32,sharedX,32,prk)&&hmac(prk,32,info,d+25,out);mbedtls_platform_zeroize(prk,32);return ok;
}
inline bool mac(const uint8_t key[32],const char*domain,uint8_t*p,size_t body){
 uint8_t data[200],hash[32];size_t d=strlen(domain);if(d+body>sizeof(data))return false;memcpy(data,domain,d);memcpy(data+d,p,body);
 if(!hmac(key,32,data,d+body,hash))return false;memcpy(p+body,hash,16);mbedtls_platform_zeroize(hash,32);return true;
}
inline bool check(const uint8_t key[32],const char*domain,const uint8_t*p,size_t body){
 uint8_t copy[Fast::EVENT];if(body+16>sizeof(copy))return false;memcpy(copy,p,body+16);if(!mac(key,domain,copy,body))return false;uint8_t diff=0;for(size_t i=body;i<body+16;++i)diff|=copy[i]^p[i];return !diff;
}
inline bool sign(mbedtls_ecp_keypair&key,mbedtls_ctr_drbg_context&rng,uint8_t*event){
 char text[180];uint8_t digest[32];if(!Fast::message(event,text,sizeof(text))||mbedtls_sha256((const uint8_t*)text,strlen(text),digest,0))return false;
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);auto&g=key.MBEDTLS_PRIVATE(grp);
 int rc=mbedtls_ecdsa_sign_det_ext(&g,&r,&s,&key.MBEDTLS_PRIVATE(d),digest,32,MBEDTLS_MD_SHA256,mbedtls_ctr_drbg_random,&rng);
 if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);if(!rc&&mbedtls_mpi_cmp_mpi(&s,&half)>0)rc=mbedtls_mpi_sub_mpi(&s,&g.N,&s);
 if(!rc)rc=mbedtls_mpi_write_binary(&r,event+64,32);if(!rc)rc=mbedtls_mpi_write_binary(&s,event+96,32);
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return !rc;
}
inline bool verify(mbedtls_ecp_keypair&key,const uint8_t*event){
 char text[180];uint8_t digest[32];if(!Fast::message(event,text,sizeof(text))||mbedtls_sha256((const uint8_t*)text,strlen(text),digest,0))return false;
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);auto&g=key.MBEDTLS_PRIVATE(grp);
 int rc=mbedtls_mpi_read_binary(&r,event+64,32);if(!rc)rc=mbedtls_mpi_read_binary(&s,event+96,32);if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);
 bool ok=!rc&&mbedtls_mpi_cmp_int(&r,0)>0&&mbedtls_mpi_cmp_mpi(&r,&g.N)<0&&mbedtls_mpi_cmp_int(&s,0)>0&&mbedtls_mpi_cmp_mpi(&s,&half)<=0&&!mbedtls_ecdsa_verify(&g,digest,32,&key.MBEDTLS_PRIVATE(Q),&r,&s);
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return ok;
}
}
