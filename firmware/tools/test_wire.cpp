#include "../Gateway/TagWire.h"
#include <cstdio>
const uint8_t proof[]={66,84,65,71,1,1,1,0,16,32,48,64,80,96,104,111,115,116,116,101,115,116,1,0,0,0,40,35,0,0,20,0,0,0,0,0,232,3,0,0,0,0,0,0,184,11,183,97,255,255,126,29,78,139,154,115,143,27,12,77,144,0,153,122,17,204,172,230,140,127,142,71,70,195,128,233,174,28,249,185,174,37,1,3,51,81,195,235,79,40,163,228,0,139,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,98,147,236,17,62,86,146,0,87,99,222,173,191,59,178,174,78,231,28,232,167,219,246,252,54,178,190,228,251,47,68,207,85,44,94,69,140,123,60,224,74,211,37,12,238,139,254,217,99,150,94,150,219,189,15,103,61,60,193,0,182,150,45,8};
const uint8_t request[]={66,84,81,49,183,97,255,255,126,29,78,139,154,115,143,27,12,77,144,0,153,122,17,204,172,230,140,127,142,71,70,195,128,233,174,28,249,185,174,37,1,3,51,81,195,235,79,40,163,228,0,139,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31};
const uint8_t device[]={16,32,48,64,80,96};
int main(){unsigned checks=0;
 auto accept=[&](const uint8_t*p,size_t n,int tag,bool pending,unsigned age){return TagWire::fieldsMatch(p,n,tag,device,request,pending,age);};
 if(!accept(proof,190,0,true,10))return 1;++checks;
 for(unsigned i=0;i<126;++i){if(i>=14&&i<46)continue;uint8_t p[190];memcpy(p,proof,190);p[i]^=1;if(accept(p,190,0,true,10))return 2;++checks;}
 if(accept(proof,189,0,true,10)||accept(proof,190,0,false,10)||accept(proof,190,0,true,5001)||accept(proof,190,1,true,10))return 3;checks+=4;
 uint8_t p[190];memcpy(p,proof,190);memset(p+22,0,4);if(accept(p,190,0,true,10))return 4;++checks;
 memcpy(p,proof,190);p[30]=0xE9;p[31]=3;if(accept(p,190,0,true,10))return 5;++checks;
 memcpy(p,proof,190);p[6]=0;p[30]=p[31]=255;for(int i=0;i<7;++i){p[32+2*i]=0;p[33+2*i]=128;}
 if(!accept(p,190,0,true,10))return 6;++checks;
 p[6]=2;if(accept(p,190,0,true,10))return 7;++checks;
 printf("PASS: %u actual C++ wire-validation checks.\n",checks);return 0;
}
