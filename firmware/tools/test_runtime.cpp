#include "../Gateway/RuntimePolicy.h"
#include <cassert>
#include <cstdio>
#include <climits>
unsigned checks=0;
#define CHECK(x) do{assert(x);++checks;}while(0)
int main(){
 using namespace RuntimePolicy;Retry r;CHECK(r.due(0));r.finish(100,false,4000);CHECK(r.wait==500);CHECK(!r.due(599));CHECK(r.due(600));
 r.finish(600,false,4000);CHECK(r.wait==1000);r.finish(1600,false,4000);CHECK(r.wait==2000);r.finish(3600,false,4000);CHECK(r.wait==4000);
 r.finish(7600,false,4000);CHECK(r.wait==4000);r.finish(8000,true,4000);CHECK(r.failures==0);CHECK(!r.due(11999));CHECK(r.due(12000));
 r.finish(UINT_MAX-100,true,4000);CHECK(!r.due(200));CHECK(r.due(4000));
 Retry both[2];bool seen[2]={true,true};uint32_t at[2]={100,100};
 CHECK(selectTag(100,0,seen,at,both)==0);CHECK(selectTag(100,1,seen,at,both)==1);
 both[0].finish(100,false,4000);CHECK(selectTag(100,0,seen,at,both)==1);
 seen[1]=false;CHECK(selectTag(100,0,seen,at,both)==-1);CHECK(selectTag(600,0,seen,at,both)==0);
 CHECK(selectTag(5200,0,seen,at,both)==-1); // stale advertiser is not repeatedly connected
 seen[1]=true;at[1]=5400;CHECK(selectTag(5400,0,seen,at,both)==1);
 at[0]=UINT_MAX-100;both[0]=Retry{};seen[1]=false;CHECK(selectTag(10,0,seen,at,both)==0);
 for(unsigned now=0;now<10000;++now){for(unsigned tags=0;tags<=2;++tags){auto d=leds(now,true,false,true,tags,false,false,38,26);CHECK(d.green<=38&&d.red<=26);if(tags==2)CHECK(d.red==0);if(tags==0)CHECK(d.green==0);}}
 auto d=leds(50,true,false,true,1,false,false,38,26);CHECK(d.red==26);d=leds(120,true,false,true,1,false,false,38,26);CHECK(d.red==0);
 d=leds(220,true,false,true,1,false,false,38,26);CHECK(d.red==26);d=leds(300,true,false,true,1,false,false,38,26);CHECK(d.red==0);
 d=leds(100,true,false,true,2,true,false,38,26);CHECK(d.red<=26);
 d=leds(20,false,true,true,2,false,true,38,26);CHECK(d.red==0&&d.green==0);
 d=leds(20,true,true,true,2,false,true,38,26);CHECK(d.red==26&&d.green==0);
 d=leds(20,true,false,true,2,false,true,38,26);CHECK(d.red==26);d=leds(120,true,false,true,2,false,true,38,26);CHECK(d.red==0);
 printf("Runtime policy: %u checks passed\n",checks);
}
