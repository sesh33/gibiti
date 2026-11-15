import { Fingerprint, ShieldCheck, ScanLine } from "lucide-react";

export function AccessPillars() {
  return (
    <div
      className="access-pillars"
      role="group"
      aria-label="Workspace access principles"
    >
      <div>
        <Fingerprint size={20} />
        <strong>Individual access</strong>
        <span>A workspace identity for every teammate.</span>
      </div>
      <div>
        <ShieldCheck size={20} />
        <strong>Deliberate permissions</strong>
        <span>The right tools. The right level of access.</span>
      </div>
      <div>
        <ScanLine size={20} />
        <strong>Accountable actions</strong>
        <span>Important changes stay reviewable.</span>
      </div>
    </div>
  );
}
