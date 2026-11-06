#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Sounds.h"
// Channel 8 uses the other ESP32 LEDC speed group, isolating sound frequencies
// from the LEDs' 5 kHz timers. Never run this driver on the BLE worker task.
class SoundOutput {
 bool attached=false,allowed=false;int lastHz=-1;
public:
 Audio::Player player;bool activeModule=Config::DEFAULT_ACTIVE_BUZZER,activeLow=Config::DEFAULT_ACTIVE_LOW;
 bool sounding()const{return allowed&&player.hz>0;}
 void stop(){player.stop();if(attached){ledcWrite(Config::BUZZER_PIN,0);ledcDetach(Config::BUZZER_PIN);}attached=false;allowed=false;lastHz=-1;pinMode(Config::BUZZER_PIN,INPUT);}
 void request(Audio::Kind kind,uint8_t tag=0){if(Config::ENABLE_BUZZER)player.request(kind,tag);}
 void tick(uint32_t now,bool powered){
  if(!powered||!Config::ENABLE_BUZZER){stop();return;}allowed=true;player.tick(now);
  if(lastHz==player.hz)return;
  if(activeModule){pinMode(Config::BUZZER_PIN,OUTPUT);digitalWrite(Config::BUZZER_PIN,(player.hz>0)^activeLow?HIGH:LOW);}
  else{
   if(!attached&&player.hz){attached=ledcAttachChannel(Config::BUZZER_PIN,2000,10,8);
    if(!attached){Serial.println("AUDIO_ERROR=PWM attach failed on GPIO27");lastHz=-1;return;}}
   if(attached){if(player.hz){if(!ledcWriteTone(Config::BUZZER_PIN,player.hz)){Serial.println("AUDIO_ERROR=tone failed");stop();return;}}
    else ledcWrite(Config::BUZZER_PIN,0);}
   else{pinMode(Config::BUZZER_PIN,OUTPUT);digitalWrite(Config::BUZZER_PIN,LOW);}
  }
  lastHz=player.hz;
 }
};
