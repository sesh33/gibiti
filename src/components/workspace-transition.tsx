"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useVisualEffects } from "@/lib/visual-effects";

/** Animate the route surface, keeping forms, queries and the shell intact. */
export function WorkspaceTransition({ children }: React.PropsWithChildren) {
  const pathname = usePathname();
  const surface = useRef<HTMLDivElement>(null);
  const lastRoute = useRef<string | null>(null);
  const { cinematic } = useVisualEffects();
  useLayoutEffect(() => {
    const node = surface.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const navigation = lastRoute.current !== pathname;
    lastRoute.current = pathname;
    if (
      !node ||
      !navigation ||
      !cinematic ||
      preference.matches ||
      typeof node.animate !== "function"
    )
      return;
    const compact = window.matchMedia("(max-width: 820px)").matches;
    const animations = [
      node.animate([{ opacity: 0.4 }, { opacity: 1 }], {
        duration: compact ? 200 : 260,
        easing: "ease-out",
      }),
    ];
    const stages: HTMLElement[] = [];
    for (const candidate of node.querySelectorAll<HTMLElement>(
      ".page-heading,.workspace-hero,.metric-grid,.catalog-summary,.report-card-grid,.ops-guide,.data-panel,.repricing-live,.commerce-workflow",
    )) {
      if (stages.some((stage) => stage.contains(candidate))) continue;
      stages.push(candidate);
      if (stages.length === 6) break;
    }
    stages.forEach((stage, index) =>
      animations.push(
        stage.animate(
          [
            { opacity: 0.18, transform: `translateY(${compact ? 6 : 12}px)` },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: compact ? 270 : 420,
            delay: index * (compact ? 20 : 35),
            fill: "backwards",
            easing: "cubic-bezier(0.16,1,0.3,1)",
          },
        ),
      ),
    );
    const reduce = () => {
      if (preference.matches)
        animations.forEach((animation) => animation.cancel());
    };
    preference.addEventListener("change", reduce);
    return () => {
      animations.forEach((animation) => animation.cancel());
      preference.removeEventListener("change", reduce);
    };
  }, [pathname, cinematic]);
  return (
    <div className="route-frame" ref={surface}>
      {children}
    </div>
  );
}
