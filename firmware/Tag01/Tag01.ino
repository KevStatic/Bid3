// Upload ONLY to the physical TAG01. Arduino board: XIAO_ESP32C3.
#define BAGTRAIL_TAG_NUMBER 1
#include "BagTrailTag.h"
void setup() { BagTrail::setupTag(); }
void loop() { BagTrail::loopTag(); }
