#pragma once
#include "AuctionWire.h"
#include <mbedtls/ecdsa.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <mbedtls/platform_util.h>
namespace Bid3Crypto {
inline bool digest(const char*domain,const uint8_t*p,size_t n,uint8_t*out){
 uint8_t data[256];size_t d=strlen(domain);if(d+n>sizeof(data))return false;
 memcpy(data,domain,d);memcpy(data+d,p,n);return !mbedtls_sha256(data,d+n,out,0);
}
inline bool loadPublic(mbedtls_ecp_keypair&k,const uint8_t pub[65]){
 return !mbedtls_ecp_group_load(&k.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1)&&
 !mbedtls_ecp_point_read_binary(&k.MBEDTLS_PRIVATE(grp),&k.MBEDTLS_PRIVATE(Q),pub,65)&&
 !mbedtls_ecp_check_pubkey(&k.MBEDTLS_PRIVATE(grp),&k.MBEDTLS_PRIVATE(Q));
}
inline bool verify(mbedtls_ecp_keypair&k,const uint8_t*p,const char*domain){
 uint8_t h[32];if(!digest(domain,p,Bid3::BODY,h))return false;
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);
 auto&g=k.MBEDTLS_PRIVATE(grp);int rc=mbedtls_mpi_read_binary(&r,p+Bid3::BODY,32);
 if(!rc)rc=mbedtls_mpi_read_binary(&s,p+Bid3::BODY+32,32);
 if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);
 bool ok=!rc&&mbedtls_mpi_cmp_int(&r,0)>0&&mbedtls_mpi_cmp_mpi(&r,&g.N)<0&&
 mbedtls_mpi_cmp_int(&s,0)>0&&mbedtls_mpi_cmp_mpi(&s,&half)<=0&&
 !mbedtls_ecdsa_verify(&g,h,32,&k.MBEDTLS_PRIVATE(Q),&r,&s);
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return ok;
}
// Boot self-tests use the inherited signer. Per-intent signing omits redundant
// local verification: both gateway and authoritative engine verify the signature.
inline bool sign(mbedtls_ecp_keypair&k,mbedtls_ctr_drbg_context&rng,uint8_t*p,const char*domain){
 uint8_t h[32];if(!digest(domain,p,Bid3::BODY,h))return false;
 mbedtls_mpi r,s,half;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);mbedtls_mpi_init(&half);auto&g=k.MBEDTLS_PRIVATE(grp);
 int rc=mbedtls_ecdsa_sign_det_ext(&g,&r,&s,&k.MBEDTLS_PRIVATE(d),h,32,MBEDTLS_MD_SHA256,mbedtls_ctr_drbg_random,&rng);
 if(!rc)rc=mbedtls_mpi_copy(&half,&g.N);if(!rc)rc=mbedtls_mpi_shift_r(&half,1);
 if(!rc&&mbedtls_mpi_cmp_mpi(&s,&half)>0)rc=mbedtls_mpi_sub_mpi(&s,&g.N,&s);
 if(!rc)rc=mbedtls_mpi_write_binary(&r,p+Bid3::BODY,32);
 if(!rc)rc=mbedtls_mpi_write_binary(&s,p+Bid3::BODY+32,32);
 mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);mbedtls_mpi_free(&half);return !rc;
}
// Static ECDH plus fresh session binding. This authenticates fast controls and
// heartbeats, not transferable bid evidence. Signed intents remain independent.
inline bool sessionKey(mbedtls_ecp_keypair&own,mbedtls_ecp_keypair&peer,mbedtls_ctr_drbg_context&rng,const uint8_t*arm,uint8_t*out){
 mbedtls_ecp_point shared;mbedtls_ecp_point_init(&shared);uint8_t x[32],material[32+98];
 int rc=mbedtls_ecp_mul(&own.MBEDTLS_PRIVATE(grp),&shared,&own.MBEDTLS_PRIVATE(d),&peer.MBEDTLS_PRIVATE(Q),mbedtls_ctr_drbg_random,&rng);
 if(!rc)rc=mbedtls_mpi_write_binary(&shared.MBEDTLS_PRIVATE(X),x,32);
 if(!rc){memcpy(material,x,32);memcpy(material+32,arm+8,98);rc=!digest("Bid3.Session.v1",material,sizeof(material),out);}
 mbedtls_ecp_point_free(&shared);mbedtls_platform_zeroize(x,sizeof(x));mbedtls_platform_zeroize(material,sizeof(material));return !rc;
}
inline bool mac(const uint8_t key[32],uint8_t*p,const char*domain){
 uint8_t data[200],h[32];size_t d=strlen(domain);if(d+Bid3::BODY>sizeof(data))return false;
 memcpy(data,domain,d);memcpy(data+d,p,Bid3::BODY);
 const auto*md=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
 if(!md||mbedtls_md_hmac(md,key,32,data,d+Bid3::BODY,h))return false;
 memcpy(p+Bid3::BODY,h,16);mbedtls_platform_zeroize(h,sizeof(h));return true;
}
inline bool checkMac(const uint8_t key[32],const uint8_t*p,const char*domain){
 uint8_t copy[Bid3::SIGNED];memcpy(copy,p,Bid3::MACED);if(!mac(key,copy,domain))return false;
 uint8_t diff=0;for(size_t i=Bid3::BODY;i<Bid3::MACED;++i)diff|=copy[i]^p[i];return !diff;
}
}
