// Upload ONLY to the physical TAG02. Arduino board: XIAO_ESP32C3.
#define BAGTRAIL_TAG_NUMBER 2
#include "BagTrailTag.h"
void setup() { BagTrail::setupTag(); }
void loop() { BagTrail::loopTag(); }
