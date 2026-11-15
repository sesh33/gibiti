"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Moon, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useVisualEffects } from "@/lib/visual-effects";

const options = [
  {
    value: "cinematic",
    label: "Cinematic",
    description: "Sculpted light, reactive surfaces and fluid motion.",
    icon: Sparkles,
  },
  {
    value: "quiet",
    label: "Quiet",
    description: "Steady surfaces, softer light and minimal motion.",
    icon: Moon,
  },
] as const;

export function VisualEffectsControl({
  floating = false,
}: {
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const group = useId();
  const { mode, cinematic, systemReduced, setMode } = useVisualEffects();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`icon-button visual-effects-trigger${floating ? " effects-floating" : ""}`}
          aria-label="Visual effects"
          data-effects-active={cinematic}
          title="Visual effects"
        >
          <Sparkles size={17} aria-hidden="true" />
          {floating && <span>Appearance</span>}
        </button>
      </DialogTrigger>
      <DialogContent>
        <div className="effects-dialog-symbol" aria-hidden="true">
          <Sparkles size={24} />
        </div>
        <DialogTitle>Set the atmosphere.</DialogTitle>
        <DialogDescription>
          Your workspace. Your pace. This preference stays on this browser.
        </DialogDescription>
        <fieldset className="effects-mode-options">
          <legend className="effects-visually-hidden">Visual style</legend>
          {options.map(({ value, label, description, icon: Icon }) => (
            <label
              key={value}
              className="effects-mode-option"
              data-checked={mode === value}
            >
              <input
                className="effects-mode-radio"
                type="radio"
                name={group}
                value={value}
                aria-label={label}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span
                className={`effects-mode-preview effects-preview-${value}`}
                aria-hidden="true"
              >
                <Icon size={23} />
              </span>
              <span className="effects-mode-copy">
                <strong>{label}</strong>
                <span>{description}</span>
              </span>
              <span className="effects-mode-check" aria-hidden="true">
                {mode === value && <Check size={15} />}
              </span>
            </label>
          ))}
        </fieldset>
        <p className="effects-preference-note">
          {systemReduced
            ? "Your device’s reduced-motion setting is active and takes priority."
            : "Motion adapts to your device and pauses when the page is hidden."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function PublicVisualEffectsControl() {
  const pathname = usePathname();
  return ["/login", "/mfa", "/setup/owner", "/account/setup"].includes(
    pathname,
  ) ? (
    <VisualEffectsControl floating />
  ) : null;
}
