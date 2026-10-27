import { ArrowUpRight, Inbox } from "lucide-react";
import Link from "next/link";
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Link className="empty-link" href={action.href}>
          {action.label}
          <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}
export function QueryError({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="query-error" role="alert">
      <strong>Unable to load this module</strong>
      <p>{message}</p>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
