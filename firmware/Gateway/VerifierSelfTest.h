#pragma once
// Public-only synthetic cross-implementation test vector; NEVER an enrolled tag.
static const uint8_t katPub[65]={4,15,9,97,84,245,97,149,93,87,150,5,188,112,28,141,157,244,61,222,241,66,87,157,65,120,95,194,113,143,69,95,215,80,246,10,118,73,165,8,93,73,59,21,99,40,161,77,154,127,160,51,177,166,113,94,43,223,130,197,8,127,217,18,138};
static const uint8_t katDevice[6]={16,32,48,64,80,96};
static const uint8_t katRequest[84]={66,84,81,49,183,97,255,255,126,29,78,139,154,115,143,27,12,77,144,0,153,122,17,204,172,230,140,127,142,71,70,195,128,233,174,28,249,185,174,37,1,3,51,81,195,235,79,40,163,228,0,139,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31};
static const uint8_t katProof[190]={66,84,65,71,1,1,1,0,16,32,48,64,80,96,104,111,115,116,116,101,115,116,1,0,0,0,40,35,0,0,20,0,0,0,0,0,232,3,0,0,0,0,0,0,184,11,183,97,255,255,126,29,78,139,154,115,143,27,12,77,144,0,153,122,17,204,172,230,140,127,142,71,70,195,128,233,174,28,249,185,174,37,1,3,51,81,195,235,79,40,163,228,0,139,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,98,147,236,17,62,86,146,0,87,99,222,173,191,59,178,174,78,231,28,232,167,219,246,252,54,178,190,228,251,47,68,207,85,44,94,69,140,123,60,224,74,211,37,12,238,139,254,217,99,150,94,150,219,189,15,103,61,60,193,0,182,150,45,8};
inline bool externalVerifierSelfTest(){
 Security::Enrollment test;mbedtls_ecp_keypair_init(&test.key);memcpy(test.device,katDevice,6);
 int rc=mbedtls_ecp_group_load(&test.key.MBEDTLS_PRIVATE(grp),MBEDTLS_ECP_DP_SECP256K1);
 if(!rc)rc=mbedtls_ecp_point_read_binary(&test.key.MBEDTLS_PRIVATE(grp),&test.key.MBEDTLS_PRIVATE(Q),katPub,65);
 bool pending=true;uint8_t digest[32];
 bool ok=!rc&&Security::verifyAgainst(katProof,190,0,test,katRequest,pending,10,digest)&&!pending;
 pending=true;uint8_t changed[190];memcpy(changed,katProof,190);changed[189]^=1;
 ok=ok&&!Security::verifyAgainst(changed,190,0,test,katRequest,pending,10,digest);
 mbedtls_ecp_keypair_free(&test.key);return ok;
}
