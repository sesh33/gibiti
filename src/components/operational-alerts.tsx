"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bell } from "lucide-react";

export function OperationalAlerts({
  configured,
  canManageSettings,
}: {
  configured: boolean;
  canManageSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target)
      )
        setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  return (
    <div className="operational-alert-anchor" ref={anchor}>
      <button
        ref={trigger}
        className="icon-button"
        aria-label="Operational alerts"
        aria-expanded={open}
        aria-controls="operational-alerts"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} />
      </button>
      {open && (
        <div
          id="operational-alerts"
          className="notification-panel"
          role="region"
          aria-label="Operational alerts"
        >
          <strong>Operational alerts</strong>
          <p>Buyer messaging is not included in the Eldorado Seller API.</p>
          {!configured && <p>Configure Supabase before inviting your team.</p>}
          {canManageSettings ? (
            <Link href="/settings" onClick={() => setOpen(false)}>
              View integration status <ArrowUpRight size={12} />
            </Link>
          ) : (
            <p>
              Your Owner manages integration access. Your staff permissions
              remain in effect.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
