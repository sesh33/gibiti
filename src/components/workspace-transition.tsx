"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Animate the route surface, keeping forms, queries and the shell intact. */
export function WorkspaceTransition({ children }: React.PropsWithChildren) {
  const pathname = usePathname();
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = surface.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!node || preference.matches || typeof node.animate !== "function")
      return;
    const compact = window.matchMedia("(max-width: 820px)").matches;
    const animation = node.animate(
      [
        {
          opacity: 0.16,
          transform: `translateY(${compact ? 8 : 16}px)`,
          filter: compact ? "none" : "blur(2px)",
        },
        { opacity: 1, transform: "none", filter: "none" },
      ],
      {
        duration: compact ? 280 : 480,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
    const reduce = () => {
      if (preference.matches) animation.cancel();
    };
    preference.addEventListener("change", reduce);
    return () => {
      animation.cancel();
      preference.removeEventListener("change", reduce);
    };
  }, [pathname]);
  return (
    <div className="route-frame" ref={surface}>
      {children}
    </div>
  );
}
