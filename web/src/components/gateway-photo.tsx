"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** A local playback of actual firmware framebuffers over the photographed OLED. */
export function GatewayPhoto() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paused = useRef(false);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const screen = canvas.current!;
    const context = screen.getContext("2d", { alpha: false });
    if (!context) return;
    const abort = new AbortController();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let request = 0, lastTime = 0, elapsed = 0, previousFrame = -1;
    let visible = false, destroyed = false;
    let data: Uint8Array | undefined, fps = 25, count = 0;
    const pixels = context.createImageData(128, 64);

    function draw(index: number) {
      if (!data || index === previousFrame) return;
      const offset = 24 + index * 1024;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
        const on = data[offset + x + Math.floor(y / 8) * 128] & (1 << (y % 8));
        const i = (y * 128 + x) * 4;
        pixels.data[i] = on ? 0 : 3;
        pixels.data[i + 1] = on ? 201 : 7;
        pixels.data[i + 2] = on ? 255 : 11;
        pixels.data[i + 3] = 255;
      }
      context!.putImageData(pixels, 0, 0);
      previousFrame = index;
      screen.style.opacity = "1";
    }

    function stop() { cancelAnimationFrame(request); request = 0; lastTime = 0; }
    function run() {
      if (destroyed || !data || !visible || document.hidden || paused.current || reduced.matches) return;
      if (!request) request = requestAnimationFrame(tick);
    }
    function tick(now: number) {
      request = 0;
      if (lastTime) elapsed += Math.min(now - lastTime, 100);
      lastTime = now;
      draw(Math.floor(elapsed * fps / 1000) % count);
      run();
    }
    function update() {
      stop();
      // A representative still under reduced motion; manual pause keeps its frame.
      if (reduced.matches && data) draw(Math.min(24, count - 1));
      else run();
    }
    const observer = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run(); else stop();
    });
    observer.observe(screen);
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    screen.addEventListener("playbackchange", update);

    fetch("/animations/gateway-oled.bin", { signal: abort.signal })
      .then((response) => { if (!response.ok) throw new Error("OLED preview unavailable"); return response.arrayBuffer(); })
      .then((buffer) => {
        if (destroyed) return;
        const header = new DataView(buffer);
        const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 7));
        if (magic !== "B3OLED1" || header.getUint32(8, true) !== 128 || header.getUint32(12, true) !== 64) return;
        fps = header.getUint32(16, true); count = header.getUint32(20, true);
        if (!fps || !count || buffer.byteLength !== 24 + count * 1024) return;
        data = new Uint8Array(buffer);
        draw(24); update();
      })
      .catch(() => { /* The original photographed screen remains the fallback. */ });

    return () => {
      destroyed = true; abort.abort(); stop(); observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
      screen.removeEventListener("playbackchange", update);
    };
  }, []);

  return (
    <figure className="min-w-0">
      <div className="relative">
        <Image
          src="/images/gateway-cutout.png"
          alt="BID3 gateway with an animated preview of its actual OLED firmware"
          width={1446}
          height={1088}
          sizes="(min-width: 1280px) 540px, (min-width: 1024px) 45vw, (min-width: 640px) 90vw, 100vw"
          className="h-auto w-full"
          preload
        />
        <canvas
          ref={canvas}
          width={128}
          height={64}
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[1px] opacity-0"
          style={{ left: "14.938%", top: "31.434%", width: "28.008%", height: "17.923%", imageRendering: "pixelated" }}
        />
      </div>
      <figcaption className="mt-3 flex items-center justify-center gap-3 text-xs text-ink-3">
        <span>Firmware OLED preview</span>
        <button
          type="button"
          className="min-h-9 rounded-md px-2 text-ink-2 hover:bg-surface-2"
          aria-label={playing ? "Pause OLED preview" : "Play OLED preview"}
          onClick={() => {
            paused.current = !paused.current;
            setPlaying(!paused.current);
            canvas.current?.dispatchEvent(new Event("playbackchange"));
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </figcaption>
    </figure>
  );
}
