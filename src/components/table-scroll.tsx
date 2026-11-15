"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";

/** A keyboard scroll target only when the real table exceeds its viewport. */
export function TableScroll({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  const viewport = useRef<HTMLDivElement>(null);
  const hint = useId();
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const next = node.scrollWidth > node.clientWidth + 1;
      setOverflow((previous) => (previous === next ? previous : next));
    };
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    observer?.observe(node);
    const table = node.querySelector("table");
    if (table) observer?.observe(table);
    // Content can change without changing the scrollport's height or width.
    const changes =
      typeof MutationObserver === "function"
        ? new MutationObserver(schedule)
        : null;
    changes?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      observer?.disconnect();
      changes?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={viewport}
      className="table-scroll table-scroll-region"
      role={overflow ? "region" : undefined}
      aria-label={overflow ? label : undefined}
      aria-describedby={overflow ? hint : undefined}
      tabIndex={overflow ? 0 : undefined}
      data-overflow={overflow ? "true" : undefined}
    >
      {overflow && (
        <div className="table-scroll-hint" id={hint}>
          <ArrowLeftRight size={13} aria-hidden="true" />
          <span>Scroll to see all columns</span>
          <span className="table-scroll-keyboard-help">
            Use the arrow keys or swipe.
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
