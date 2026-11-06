# Working baseline provenance

V4 was rebuilt from the exact owner-provided working archive `BagTrail_Tag01_Tag02_Gateway_D2_Button_V1.zip`.

Archive SHA256: `b3066a2419b366fd2e4845b853a2d3da60a310938ee3ed96217860ca4e649866`.

`BASELINE_SHA256.json` records the original security, wire, button and output helpers. The regression checks compare unchanged active helpers against these hashes. V5 intentionally changes Oled.h to add urgent frame replacement; its original hash remains here for provenance and test_oled.cpp verifies the new behavior. The archive and generated binaries are deliberately excluded from Git; prior V2 sources remain available in branch history at `37b74d5`.

The two BASELINE_ documents describe the historical working button firmware. Active upload instructions and auction behavior are in the parent directory.
