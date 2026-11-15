"use client";

import { useEffect, useRef } from "react";

/** Decorative light only. No account state, networking or per-frame React work. */
export function WorkspaceAtmosphere() {
  const atmosphere = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = atmosphere.current;
    if (!element) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)"),
      precision = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0,
      pointerX = 0,
      pointerY = 0,
      removePointerListeners = () => {};

    const hidePointer = () => {
      element.dataset.pointerActive = "false";
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const paintPointer = () => {
      frame = 0;
      if (document.hidden) return;
      element.style.setProperty("--atmosphere-x", `${pointerX}px`);
      element.style.setProperty("--atmosphere-y", `${pointerY}px`);
      element.dataset.pointerActive = "true";
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || document.hidden) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      // Coalesce pointer events; there is no idle animation loop.
      if (!frame) frame = requestAnimationFrame(paintPointer);
    };
    const configurePointer = () => {
      removePointerListeners();
      hidePointer();
      if (motion.matches || !precision.matches) return;
      window.addEventListener("pointermove", movePointer, { passive: true });
      window.addEventListener("pointerleave", hidePointer);
      window.addEventListener("blur", hidePointer);
      removePointerListeners = () => {
        window.removeEventListener("pointermove", movePointer);
        window.removeEventListener("pointerleave", hidePointer);
        window.removeEventListener("blur", hidePointer);
      };
    };
    const visibility = () => {
      element.dataset.paused = String(document.hidden);
      if (document.hidden) hidePointer();
    };

    configurePointer();
    visibility();
    motion.addEventListener("change", configurePointer);
    precision.addEventListener("change", configurePointer);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      removePointerListeners();
      motion.removeEventListener("change", configurePointer);
      precision.removeEventListener("change", configurePointer);
      document.removeEventListener("visibilitychange", visibility);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={atmosphere} className="workspace-atmosphere" aria-hidden="true">
      <div className="atmosphere-aurora atmosphere-aurora-blue" />
      <div className="atmosphere-aurora atmosphere-aurora-cyan" />
      <div className="atmosphere-aurora atmosphere-aurora-violet" />
      <div className="atmosphere-coordinate-field" />
      <div className="atmosphere-stars" />
      <div className="atmosphere-cursor-halo" />
      <div className="atmosphere-vignette" />
    </div>
  );
}
