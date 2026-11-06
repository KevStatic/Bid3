// Frontend asset export. Read the existing firmware renderer without changing it.
// clang++ -std=c++17 scripts/render-gateway-oled.cpp -o /tmp/bid3-oled-export
// /tmp/bid3-oled-export public/animations/gateway-oled.bin
#include "../../firmware/Gateway/Visuals.h"
#include <fstream>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  std::ofstream out(argv[1], std::ios::binary);
  if (!out) return 3;
  const unsigned fps = Config::DISPLAY_FPS;
  const unsigned count = (3800 + 3 * 6000) * fps / 1000;
  out.write("B3OLED1\0", 8);
  auto u32 = [&](unsigned value) {
    for (int byte = 0; byte < 4; ++byte) out.put(char((value >> (byte * 8)) & 255));
  };
  u32(128); u32(64); u32(fps); u32(count);
  View view; Canvas canvas;
  view.radioReady = true;
  std::strcpy(view.phase, "SCAN");
  // No synthetic bidders, bids or proof counts: this is an idle gateway preview.
  for (unsigned frame = 0; frame < count; ++frame) {
    const uint32_t now = frame * 1000 / fps;
    drawVisual(canvas, view, now, now, Config::DISPLAY_LOCATION);
    out.write(reinterpret_cast<const char*>(canvas.pixels), sizeof(canvas.pixels));
  }
  return out.good() ? 0 : 4;
}
