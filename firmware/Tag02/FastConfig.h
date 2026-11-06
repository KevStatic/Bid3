#pragma once
// Default: original proof first, then the faster authenticated input channel.
// Set to 0 only for an exact legacy-radio diagnostic (no auction bid intents).
#ifndef BID3_ENABLE_FAST_CHANNEL
#define BID3_ENABLE_FAST_CHANNEL 1
#endif
