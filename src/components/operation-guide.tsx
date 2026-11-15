import type { LucideIcon } from "lucide-react";

/** A compact orientation strip. Labels describe the workflow, never live status. */
export function OperationGuide({
  icon: Icon,
  label,
  title,
  steps,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  steps: string[];
}) {
  return (
    <section className="ops-guide" aria-label={label}>
      <div className="ops-guide-intro">
        <span className="ops-guide-icon" aria-hidden="true">
          <Icon size={21} />
        </span>
        <div>
          <span className="ops-guide-label">{label}</span>
          <strong>{title}</strong>
        </div>
      </div>
      <div className="ops-guide-steps">
        {steps.map((step, index) => (
          <span key={step}>
            <b aria-hidden="true">{String(index + 1).padStart(2, "0")}</b>
            {step}
          </span>
        ))}
      </div>
    </section>
  );
}

export function OperationPanelHeading({
  icon: Icon,
  title,
  description,
  label,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  label: string;
}) {
  return (
    <div className="ops-panel-heading">
      <div className="ops-panel-heading-main">
        <span className="ops-panel-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <span className="ops-panel-label">{label}</span>
    </div>
  );
}
