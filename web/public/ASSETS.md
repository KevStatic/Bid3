# Landing-page assets

- `brand/bid3-logo.png`: the owner's approved, transparent BID3 symbol. The browser
  icon in `src/app/icon.png` is a resized copy of this same asset.
- `images/gateway-cutout.png`: the owner's IMG_5659.jpg, retouched to remove the
  charger connector, background and uneven shadow. The original product, labels
  and controls are preserved.
- `images/tag-cutout.png`: IMG_5674.jpg is the primary photograph; IMG_5667.jpg
  supplies clearer detail and lighting reference. The physical ID lettering was
  cleared so TAG01, TAG02 and TAG03 can be placed on the label by the page.

The logo and photo retouches used the built-in image generation/editing tool.
The user approved these final assets. Original photos are not packaged here.
The tag IDs are presentation labels, not claims about connected hardware.

## OLED preview

`animations/gateway-oled.bin` contains the existing firmware renderer's original
128×64 monochrome framebuffers at 25 fps. It replays startup and the three idle
screens, with no fabricated bidders, accepted bids or hardware connection.
`GatewayPhoto` colours the pixels cyan and fits them over the photographed OLED.

To regenerate from the repository's existing firmware headers, run from `web/`:

```sh
clang++ -std=c++17 scripts/render-gateway-oled.cpp -o /tmp/bid3-oled-export
/tmp/bid3-oled-export public/animations/gateway-oled.bin
```

The exporter reads firmware headers; it does not modify or flash firmware. The
generated asset is checked in, so production builds need neither a C++ compiler
nor access to devices. The bitmap font's BSD attribution is retained in
`animations/OLED_FONT_LICENSE.txt`.
