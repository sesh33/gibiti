"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { QueryError } from "@/components/empty-state";
import { Activity, ArrowUpRight, ShieldCheck, History } from "lucide-react";

type Status = {
  connection: {
    configured: boolean;
    verifiedAt: string | null;
    verifiedOnThisServer: boolean;
  };
  settings: { autoDeliveryEnabled: boolean; autoPricingEnabled: boolean };
  runtime: {
    last_error_code: string | null;
    backoff_until: string | null;
  } | null;
};
export function OperationalSummary({ configured }: { configured: boolean }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const status = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () => api<Status>("/api/automation/settings"),
    enabled: configured,
    retry: false,
  });
  const offers = useQuery({
    queryKey: ["overview-offers"],
    queryFn: () =>
      api<{ items: { state: string }[]; nextCursor: string | null }>(
        "/api/offers",
      ),
    enabled: configured && !!me.data?.permissions.includes("offers.read"),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["approvals"],
    queryFn: () =>
      api<{
        items: {
          id: string;
          action: string;
          status: string;
          created_at: string;
        }[];
      }>("/api/approvals"),
    enabled: configured,
    retry: false,
  });
  const unresolved =
    history.data?.items.filter((item) =>
      ["blocked", "executing"].includes(item.status),
    ) ?? [];
  return (
    <div className="overview-grid overview-control-grid">
      <section className="data-panel settings-section overview-control-card">
        <div className="overview-card-heading">
          <span className="overview-card-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <span className="eyebrow">OPERATIONAL HEALTH</span>
            <h2>Connection and operational alerts</h2>
          </div>
        </div>
        {status.isPending && (
          <p className="scope-note">
            {configured
              ? "Checking saved connection…"
              : "Connection requires secure setup."}
          </p>
        )}
        {status.isError && <QueryError message={status.error.message} />}
        {status.data && (
          <>
            <p className="scope-note">
              {status.data.connection.verifiedOnThisServer
                ? "Seller read verified from this hosted server."
                : status.data.connection.configured
                  ? "Credentials configured; Owner read verification is still required on this server."
                  : "Eldorado connection is not configured. The Owner can connect it in Settings."}
            </p>
            <p className="scope-note">
              Last verified read:{" "}
              {status.data.connection.verifiedAt
                ? new Date(status.data.connection.verifiedAt).toLocaleString()
                : "None recorded"}
              .
            </p>
            <p className="scope-note">
              Automatic pricing:{" "}
              {status.data.settings.autoPricingEnabled
                ? "Authorized; reviewed rules only"
                : "Off"}
              . Automatic delivery marking:{" "}
              {status.data.settings.autoDeliveryEnabled
                ? "Authorized; fulfilled and reviewed requests only"
                : "Off"}
              .
            </p>
            {status.data.runtime?.last_error_code && (
              <p role="alert">
                Runner attention: {status.data.runtime.last_error_code}.
              </p>
            )}
            {status.data.runtime?.backoff_until && (
              <p className="scope-note">
                Background cooldown until {status.data.runtime.backoff_until}.
              </p>
            )}
          </>
        )}
        {offers.data && (
          <p className="scope-note">
            {offers.data.items.filter((item) => item.state === "Active").length}{" "}
            Active source records among the latest {offers.data.items.length}{" "}
            synchronized offer records
            {offers.data.nextCursor ? " (more available)" : ""}. Source records
            can overlap.
          </p>
        )}
        {offers.isError && <QueryError message={offers.error.message} />}
        {unresolved.length > 0 && (
          <p role="alert">
            {unresolved.length} uncertain or unfinished operations need a status
            check. Their writes will not be sent again.
          </p>
        )}
        <Link className="empty-link" href="/automation">
          Review automation and saved rules <ArrowUpRight size={14} />
        </Link>
      </section>
      <section className="data-panel settings-section overview-history-card">
        <div className="overview-card-heading">
          <span className="overview-card-icon">
            <History size={19} />
          </span>
          <div>
            <span className="eyebrow">ACCOUNTABILITY</span>
            <h2>Recent action history</h2>
          </div>
        </div>
        {history.isPending && (
          <p className="scope-note">
            {configured
              ? "Loading visible requests…"
              : "History appears after sign-in."}
          </p>
        )}
        {history.isError && <QueryError message={history.error.message} />}
        {history.data?.items.slice(0, 5).map((item) => (
          <div className="capability-list overview-history-item" key={item.id}>
            <div>
              <span>
                <Activity size={13} />
                {item.action}
              </span>
              <strong className="pill pill-muted">{item.status}</strong>
            </div>
            <p className="scope-note">
              {new Date(item.created_at).toLocaleString()}
            </p>
          </div>
        ))}
        {history.data && !history.data.items.length && (
          <p className="scope-note">
            No action requests are visible in your current access scope.
          </p>
        )}
        <Link className="empty-link" href="/approvals">
          Open reviewed operations <ArrowUpRight size={14} />
        </Link>
      </section>
    </div>
  );
}
