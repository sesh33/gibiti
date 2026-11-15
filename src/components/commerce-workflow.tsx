import { ChevronRight } from "lucide-react";

/** Describes a workflow, without claiming that any step has been completed. */
export function CommerceWorkflow({
  steps,
}: {
  steps: readonly { title: string; description: string }[];
}) {
  return (
    <ol className="commerce-workflow" aria-label="Workflow guide">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className="commerce-step-number" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <strong>{step.title}</strong>
            <span>{step.description}</span>
          </div>
          {index < steps.length - 1 && (
            <ChevronRight size={15} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
