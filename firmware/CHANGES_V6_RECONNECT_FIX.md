# V6 reconnect feedback patch

This is a patch to V6, not a new radio protocol or V7 release.

## Fixed

- LOST clears the tag's OLED presence, but no longer clears its arrival/proof sound history. Repeated advertisements and authentication attempts cannot continuously restart green/chirp feedback.
- A link-loss counter invalidates queued pre-loss discovery cues even if they reach the feedback task after reconnection.
- The dedicated feedback task cancels the affected tag's current and queued NEARBY/VERIFIED sounds. The other tag's feedback, startup melody and authoritative BID ACCEPTED / BID REJECTED / SOLD cues are preserved.
- The gateway automatically identifies this patch as V6_RECONNECT_FEEDBACK_FIX at 115200 baud.

## Upload

All three complete sketch folders are included. Tag01 and Tag02 are byte-identical to V6 TAG_OFF_FIX. If both already run V6, only Gateway/Gateway.ino needs uploading. Keep every header beside its sketch, use ESP32 core 3.3.12 and leave Erase All Flash disabled. No keys or wiring change. This patch requires no engine/bridge change beyond the already-required V6 setup.

## Physical check after upload

1. Power both tags ON and let them connect; test both BID buttons with the existing engine/bridge.
2. Switch each tag OFF and back ON separately. Confirm OFF and removal of its radar dot, followed by normal recovery.
3. Interrupt one tag's power/range while leaving the other connected. Confirm LOST, no repeated discovery chirps during reconnect attempts, and continued operation of the healthy tag.
4. Interrupt both tags. With no current auction outcome or startup cue, the gateway should have no discovery tone and no sound-driven green pulses; its existing red idle warning remains.
5. Restore both tags and confirm fresh JOIN admission and normal green/red bid cues. Accepted bids remain binding throughout; the patch does not cancel them.

A healthy remaining tag retains the existing idle green breathing indication. This differs from the repeated green pulses driven by unwanted discovery sounds. The patch fixes the response to link loss; it does not establish or change the cause of an RF outage. Target builds and host tests do not replace this physical check; no literal zero-latency guarantee is made.
