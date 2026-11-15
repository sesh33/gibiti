import { Zap } from "lucide-react";

export default function Loading() {
  return (
    <div
      aria-label="Loading workspace"
      className="loading-workspace"
      role="status"
    >
      <div className="route-loading-label">
        <span className="route-loading-emblem" aria-hidden="true">
          <Zap size={18} />
        </span>
        Preparing your workspace…
      </div>
      <div className="route-loading-track" aria-hidden="true" />
      <div className="skeleton-lines" aria-hidden="true" />
      <div className="skeleton-panel" aria-hidden="true" />
    </div>
  );
}
