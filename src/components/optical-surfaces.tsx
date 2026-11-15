"use client";

import { useEffect } from "react";
import { useVisualEffects } from "@/lib/visual-effects";

const surfaceSelector =
  ".workspace-hero,.data-panel,.metric-card,.report-option,.rivox-access .auth-panel";
const properties = [
  "--surface-pointer-x",
  "--surface-pointer-y",
  "--hero-light-x",
  "--hero-light-y",
  "--hero-tilt-x",
  "--hero-tilt-y",
];

/** One delegated optical response; never moves a control or reads its value. */
export function OpticalSurfaces() {
  const { cinematic } = useVisualEffects();

  useEffect(() => {
    if (!cinematic) return;
    const precision = window.matchMedia(
      "(min-width: 821px) and (hover: hover) and (pointer: fine)",
    );
    let active: HTMLElement | null = null,
      pending: Element | null = null,
      pointerX = 0,
      pointerY = 0,
      frame = 0;
    let removePointerListeners = () => {};

    function release() {
      if (active) {
        delete active.dataset.opticalActive;
        for (const property of properties)
          active.style.removeProperty(property);
      }
      active = null;
    }
    function clear() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      release();
    }
    function paint() {
      frame = 0;
      if (document.hidden || !precision.matches) return clear();
      const candidate = pending?.closest(surfaceSelector);
      if (!(candidate instanceof HTMLElement) || !candidate.isConnected)
        return release();
      // Exactly one geometry read per pointer frame, shared by light and sculpture.
      const bounds = candidate.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return release();
      if (active !== candidate) release();
      active = candidate;
      const x = Math.min(bounds.width, Math.max(0, pointerX - bounds.left)),
        y = Math.min(bounds.height, Math.max(0, pointerY - bounds.top));
      active.dataset.opticalActive = "true";
      active.style.setProperty("--surface-pointer-x", `${x.toFixed(1)}px`);
      active.style.setProperty("--surface-pointer-y", `${y.toFixed(1)}px`);
      if (active.matches(".workspace-hero")) {
        const nx = x / bounds.width,
          ny = y / bounds.height;
        active.style.setProperty("--hero-light-x", `${(nx * 100).toFixed(1)}%`);
        active.style.setProperty("--hero-light-y", `${(ny * 100).toFixed(1)}%`);
        active.style.setProperty(
          "--hero-tilt-x",
          `${((0.5 - ny) * 12).toFixed(2)}deg`,
        );
        active.style.setProperty(
          "--hero-tilt-y",
          `${((nx - 0.5) * 16).toFixed(2)}deg`,
        );
      }
    }
    function move(event: PointerEvent) {
      if (event.pointerType === "touch" || document.hidden) return;
      pending = event.target instanceof Element ? event.target : null;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    }
    function configure() {
      removePointerListeners();
      clear();
      if (!precision.matches) return;
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerleave", clear);
      window.addEventListener("blur", clear);
      window.addEventListener("scroll", clear, {
        passive: true,
        capture: true,
      });
      removePointerListeners = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerleave", clear);
        window.removeEventListener("blur", clear);
        window.removeEventListener("scroll", clear, true);
      };
    }
    function visibility() {
      if (document.hidden) clear();
    }

    configure();
    precision.addEventListener("change", configure);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      removePointerListeners();
      precision.removeEventListener("change", configure);
      document.removeEventListener("visibilitychange", visibility);
      clear();
    };
  }, [cinematic]);

  return null;
}
