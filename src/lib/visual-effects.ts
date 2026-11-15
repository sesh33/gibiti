"use client";

import { useSyncExternalStore } from "react";

export type VisualMode = "cinematic" | "quiet";
export const visualModeStorageKey = "rivox.visual-style";
const changeEvent = "rivox:visual-style";
const reducedQuery = "(prefers-reduced-motion: reduce)";
let selectedMode: VisualMode | undefined;

function storedMode(): VisualMode {
  try {
    return window.localStorage.getItem(visualModeStorageKey) === "quiet"
      ? "quiet"
      : "cinematic";
  } catch {
    return "cinematic";
  }
}
function snapshot(): string {
  selectedMode ??= storedMode();
  return `${selectedMode}:${window.matchMedia(reducedQuery).matches ? "reduced" : "normal"}`;
}
function applyPreference() {
  const [mode, motion] = snapshot().split(":");
  document.documentElement.dataset.visualMode =
    mode === "quiet" || motion === "reduced" ? "quiet" : "cinematic";
}
function subscribe(callback: () => void) {
  const media = window.matchMedia(reducedQuery);
  const changed = () => {
    applyPreference();
    callback();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === visualModeStorageKey || event.key === null) {
      selectedMode = storedMode();
      changed();
    }
  };
  applyPreference();
  media.addEventListener("change", changed);
  window.addEventListener(changeEvent, changed);
  window.addEventListener("storage", storageChanged);
  return () => {
    media.removeEventListener("change", changed);
    window.removeEventListener(changeEvent, changed);
    window.removeEventListener("storage", storageChanged);
  };
}
function setMode(mode: VisualMode) {
  selectedMode = mode;
  try {
    window.localStorage.setItem(visualModeStorageKey, mode);
  } catch {
    /* The preference still works for this visit. */
  }
  applyPreference();
  window.dispatchEvent(new Event(changeEvent));
}
export function useVisualEffects() {
  const value = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "cinematic:normal",
  );
  const [selection, motion] = value.split(":");
  const mode: VisualMode = selection === "quiet" ? "quiet" : "cinematic";
  const systemReduced = motion === "reduced";
  const quiet = mode === "quiet" || systemReduced;
  return { mode, cinematic: !quiet, quiet, systemReduced, setMode };
}
