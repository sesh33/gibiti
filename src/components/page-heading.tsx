import {
  Activity,
  Bell,
  Boxes,
  FileChartColumn,
  Gauge,
  Layers3,
  LayoutDashboard,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="page-heading">
      <div className="page-heading-main">
        <div className="page-heading-meta">
          <span className="page-heading-icon" aria-hidden="true">
            <SectionIcon eyebrow={`${eyebrow} ${title}`} />
          </span>
          <span className="eyebrow">{eyebrow}</span>
        </div>
        <h1>
          {title}
          <span className="heading-dot" />
        </h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </section>
  );
}
function SectionIcon({ eyebrow }: { eyebrow: string }) {
  const label = eyebrow.toLowerCase();
  if (/order|fulfillment/.test(label)) return <ShoppingBag size={16} />;
  if (/pricing|automation/.test(label)) return <Gauge size={16} />;
  if (/report|invoice|document|numbers/.test(label))
    return <FileChartColumn size={16} />;
  if (/inventory|stockroom/.test(label)) return <Boxes size={16} />;
  if (/team|access|people/.test(label)) return <Users size={16} />;
  if (/approv|review|safety/.test(label)) return <ShieldCheck size={16} />;
  if (/activity|audit|trace/.test(label)) return <Activity size={16} />;
  if (/setting|integration|connect|config/.test(label))
    return <Settings2 size={16} />;
  if (/reply|inbox|messag|response|words/.test(label))
    return <MessageSquareText size={16} />;
  if (/seller|notification/.test(label)) return <Bell size={16} />;
  if (/offer|catalog|batch|import|listing/.test(label))
    return <Layers3 size={16} />;
  return <LayoutDashboard size={16} />;
}
