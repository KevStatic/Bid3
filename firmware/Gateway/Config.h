#pragma once
namespace Config {
constexpr char CHECKPOINT_ID[] = "BOM-DEMO-CHECKPOINT-01";
constexpr char DISPLAY_LOCATION[] = "BID3";
constexpr bool DEFAULT_SH1106 = true; // Serial command d toggles and saves driver
constexpr bool ENABLE_BUZZER = true; // existing 3-pin module; keep the existing 3.3 V wiring
constexpr bool DEFAULT_ACTIVE_BUZZER = false; // false=passive melody; Serial m toggles active module rhythm
constexpr bool DEFAULT_ACTIVE_LOW = false; // active modules only; Serial i toggles trigger polarity
constexpr unsigned TAG_RETURN_MS=15000; // arrival sound only after an absence, not every scan
constexpr unsigned GREEN_DUTY_MAX=38, RED_DUTY_MAX=26; // ~15% / ~10% of 255
constexpr unsigned DISPLAY_FPS=25, I2C_HZ=400000;
constexpr unsigned PROOF_INTERVAL_MS=2000, FRESH_MS=25000;
constexpr unsigned GREEN_PIN=25, RED_PIN=26, BUZZER_PIN=27, SDA_PIN=21, SCL_PIN=22;
// Trusted PUBLIC keys supplied by the user over USB. No private keys here.
constexpr const char *DEVICE_HEX[2]={"146393bef0bc","146393bef594"};
constexpr const char *PUBLIC_HEX[2]={
 "0471f77bfab9e161869957f4e734197acd9977e3f8bef5e81e3b53b731a3a872298144ebdf6fc36f55eb74558a1877f5f4c907193f49b713fe2ffcc2a3046d7dea",
 "04e4c3d6dbb3817ab725ad3397cbffee5b91206830fb1eefcd67c2436fdf8ee08d73c78f5e1ee6f407dcae6dcb4b480491e791496577b69a14e8dba9fbc0486538"};
constexpr const char *FINGERPRINT_HEX[2]={
 "62e03e55f49d7b0266a1b4a37f3a5d6beaef0d103e5da9e1b1123a077229732d",
 "29c8d86053cb68f53b60cda41370f223348948158317358c26d263a09447e360"};
}
