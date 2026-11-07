"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatMinor } from "@/lib/format";

/**
 * The live room's "Sold!" moment: party poppers in both bottom corners spray confetti across the
 * screen, a "SOLD!" stamp lands with the winning paddle and price, and (with sound on) two pops and a
 * spoken "Sold!". It shows only when the room watched the lot sell (RoomView decides), lasts
 * DURATION_MS (keep in step with .sold-celebration in globals.css), and never blocks clicks.
 * With reduced motion it shows the stamp without confetti or bouncing.
 */

const DURATION_MS = 5200;
/** Brand colours that read on both themes: paddle yellow, both cobalts, live green, coral, pink. */
const COLOURS = ["#f5c542", "#8ea0ff", "#2d46d6", "#3ccb94", "#ff7a6e", "#ff9ec7"];

// ------------------------------------------------------------------ sound preference (per browser, on by default)

const SOUND_KEY = "bid3.room.sound";
let soundPref: boolean | null = null;
const soundListeners = new Set<() => void>();

const readSound = (): boolean => {
  if (soundPref !== null) return soundPref;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};
const subscribeSound = (listener: () => void) => {
  soundListeners.add(listener);
  return () => void soundListeners.delete(listener);
};

/** Whether the room plays the "Sold!" sound, and a setter (remembered in this browser). */
export function useRoomSound(): readonly [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeSound, readSound, () => true);
  const set = (next: boolean) => {
    soundPref = next;
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Storage blocked (private mode): the choice still holds for this page.
    }
    if (next) primeSound();
    soundListeners.forEach((listener) => listener());
  };
  return [on, set] as const;
}

// ------------------------------------------------------------------ audio

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audio ??= new Ctor();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
}

/**
 * Browsers let a page make sound only after the viewer has clicked or pressed a key on it. Called from
 * such an event, this unlocks the audio and speech the celebration uses later.
 */
export function primeSound() {
  audioContext();
  if ("speechSynthesis" in window) {
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  }
}

/** Unlocks sound on the viewer's first click or key press anywhere on the page. */
export function useSoundPrimer() {
  useEffect(() => {
    const once = () => primeSound();
    window.addEventListener("pointerdown", once, { once: true, capture: true });
    window.addEventListener("keydown", once, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", once, { capture: true });
      window.removeEventListener("keydown", once, { capture: true });
    };
  }, []);
}

/** A party-popper "pop": a short burst of filtered noise, panned to one side. */
function pop(ctx: AudioContext, at: number, pan: number) {
  const length = Math.floor(ctx.sampleRate * 0.22);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 6;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1500;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  source.connect(filter).connect(gain).connect(panner).connect(ctx.destination);
  source.start(at);
}

function saySold() {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance("Sold!");
  utterance.rate = 0.7; // drawn out: "Sooold!"
  utterance.pitch = 1.1;
  utterance.volume = 1;
  const voices = synth.getVoices();
  utterance.voice = voices.find((v) => /^en[-_](US|GB|IN)/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
  synth.cancel();
  synth.speak(utterance);
}

// ------------------------------------------------------------------ confetti

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  angle: number;
  spin: number;
  tilt: number;
  tiltSpeed: number;
  wobble: number;
  round: boolean;
  maxFall: number;
}

/** Runs the confetti on `canvas` for DURATION_MS. Returns a stop function. */
function runConfetti(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const scale = Math.max(0.6, Math.min(h / 900, 1.6));
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const bits: Bit[] = [];
  const add = (x: number, y: number, vx: number, vy: number) =>
    bits.push({
      x,
      y,
      vx,
      vy,
      size: rand(7, 13) * scale,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.25, 0.25),
      tilt: rand(0, Math.PI * 2),
      tiltSpeed: rand(0.05, 0.18),
      wobble: rand(0, Math.PI * 2),
      round: Math.random() < 0.3,
      maxFall: rand(2.2, 4) * scale,
    });
  // A popper in each bottom corner fires up and inwards.
  const popper = (fromLeft: boolean, count: number) => {
    const dir = fromLeft ? 1 : -1;
    for (let i = 0; i < count; i++) add(fromLeft ? w * 0.04 : w * 0.96, h + 10, dir * rand(3, 14) * scale, -rand(17, 31) * scale);
  };
  const rain = (count: number) => {
    for (let i = 0; i < count; i++) add(rand(0, w), rand(-h * 0.4, -10), rand(-1.5, 1.5), rand(1, 3) * scale);
  };

  popper(true, 120);
  popper(false, 120);
  const timers = [
    window.setTimeout(() => (popper(true, 60), popper(false, 60)), 450),
    window.setTimeout(() => rain(110), 750),
  ];

  const start = performance.now();
  let last = start;
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 16.67, 3);
    last = now;
    const elapsed = now - start;
    const fade = Math.max(0, Math.min(1, (DURATION_MS - elapsed) / 900));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = fade;
    const drag = 0.985 ** dt;
    const gravity = 0.35 * scale * dt;
    for (const b of bits) {
      b.vx *= drag;
      b.vy = Math.min(b.vy * drag + gravity, b.maxFall);
      b.wobble += 0.08 * dt;
      b.x += (b.vx + (b.vy > 0 ? Math.sin(b.wobble) * 1.2 * scale : 0)) * dt;
      b.y += b.vy * dt;
      b.angle += b.spin * dt;
      b.tilt += b.tiltSpeed * dt;
      if (b.y > h + 40) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.scale(1, Math.cos(b.tilt));
      ctx.fillStyle = b.colour;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.size * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.size / 2, -b.size * 0.22, b.size, b.size * 0.45);
      }
    }
    if (elapsed < DURATION_MS) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener("resize", resize);
  };
}

const subscribeMotion = (listener: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ the overlay

export function SoldCelebration({
  winnerAlias,
  priceMinor,
  unit,
  sound,
}: {
  winnerAlias: string;
  priceMinor: number;
  unit: string;
  sound: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundAtStart = useRef(sound);
  const [done, setDone] = useState(false);
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!soundAtStart.current) return;
    const ctx = audioContext();
    if (ctx) {
      pop(ctx, ctx.currentTime + 0.02, -0.7);
      pop(ctx, ctx.currentTime + 0.1, 0.7);
    }
    const voice = window.setTimeout(saySold, 350);
    return () => window.clearTimeout(voice);
  }, []);

  useEffect(() => {
    if (reduce || !canvasRef.current) return;
    return runConfetti(canvasRef.current);
  }, [reduce]);

  if (done) return null;
  return (
    // Decorative: the room's status line already announces the sale to screen readers.
    <div className="sold-celebration pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden data-testid="sold-celebration">
      {reduce ? null : <canvas ref={canvasRef} className="absolute inset-0 size-full" />}
      <span className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4">
        <span className="sold-popper inline-block text-6xl sm:text-8xl">🎉</span>
      </span>
      <span className="absolute bottom-2 right-2 -scale-x-100 sm:bottom-4 sm:right-4">
        <span className="sold-popper inline-block text-6xl sm:text-8xl">🎉</span>
      </span>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-4">
        <p className="sold-stamp rounded-[1.25rem] border-[6px] border-paddle-ink bg-paddle px-[0.3em] font-wide text-[clamp(4.5rem,15vw,12rem)] font-black leading-none tracking-tight text-paddle-ink shadow-2xl">
          SOLD!
        </p>
        <p className="sold-cheers flex items-center gap-3 rounded-full border border-line bg-surface px-5 py-2 text-xl font-bold text-ink shadow-lg sm:text-3xl">
          <span className="sold-clink inline-block">🥂</span>
          <span>
            Paddle {winnerAlias} · <span className="tabular">{`${formatMinor(priceMinor)} ${unit}`}</span>
          </span>
        </p>
      </div>
    </div>
  );
}
