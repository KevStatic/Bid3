"use client";

import { useEffect, useRef, type PointerEvent } from "react";

const LINES = ["Hold a paddle.", "Press to bid.", "Last bid standing wins."];

export function HeroHeadline() {
  const heading = useRef<HTMLHeadingElement>(null);
  const frame = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function followPointer(event: PointerEvent<HTMLHeadingElement>) {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    event.currentTarget.dataset.hovered = "true";
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      heading.current?.style.setProperty("--spot-x", `${pointer.current.x}px`);
      heading.current?.style.setProperty("--spot-y", `${pointer.current.y}px`);
      frame.current = 0;
    });
  }

  return (
    <h1
      ref={heading}
      className="hero-headline text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-[4.1rem]"
      onPointerEnter={followPointer}
      onPointerMove={followPointer}
      onPointerLeave={(event) => { event.currentTarget.dataset.hovered = "false"; }}
      onPointerCancel={(event) => { event.currentTarget.dataset.hovered = "false"; }}
    >
      {LINES.map((line) => <span key={line} className="block">{line}</span>)}
      <span aria-hidden="true" className="hero-headline-spotlight text-paddle">
        {LINES.map((line) => <span key={line} className="block">{line}</span>)}
      </span>
    </h1>
  );
}
