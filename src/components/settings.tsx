"use client";
import { TableScroll } from "@/components/table-scroll";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Copy,
  Database,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { QueryError } from "@/components/empty-state";
import { EldoradoConnection } from "@/components/eldorado-connection";
import type {
  AutomationRuntimeHealth,
  IntegrationSnapshot,
  SchedulerHealth,
} from "@/domains/eldorado/integration-health";
import { cooldownTime } from "@/domains/eldorado/integration-health";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_ORIGIN",
  "ELDORADO_CLIENT_ID",
  "ELDORADO_CLIENT_SECRET",
];
export function Settings({ configured }: { configured: boolean }) {
  const [copied, setCopied] = useState("");
  const status = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{
        eldorado: boolean;
        eldoradoVerified?: boolean;
        offersVerifiedSources?: string[];
        messaging: boolean;
        database: boolean;
        liveWrites: boolean;
        availabilityActions: boolean;
        integration?: IntegrationSnapshot;
        errors: {
          provider: string;
          code: string;
          created_at: string;
          title?: string;
          action?: string;
          resolved?: boolean;
        }[];
      }>("/api/workspace/settings"),
    enabled: configured,
    refetchInterval: 60000,
    retry: false,
  });
  const scheduler = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () =>
      api<{
        scheduler?: SchedulerHealth;
        runtime: AutomationRuntimeHealth | null;
        runtimeAccess?: string;
        checkedAt?: string;
      }>("/api/automation/settings"),
    enabled: configured,
    refetchInterval: 60000,
    retry: false,
  });
  const databaseVerified = !status.isError && status.data?.database === true;
  const ordersVerified =
    !status.isError && status.data?.eldoradoVerified === true;
  const offerSources = !status.isError
    ? (status.data?.offersVerifiedSources ?? [])
    : [];
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied("Clipboard unavailable; select the variable name to copy it.");
    }
  }
  return (
    <div className="settings-workspace">
      <PageHeading
        eyebrow="WORKSPACE CONFIGURATION"
        title="Connected carefully. Controlled completely."
        description="Server-side credentials, explicit capabilities, and a clear integration status."
      >
        <Button
          variant="outline"
          onClick={() => Promise.all([status.refetch(), scheduler.refetch()])}
          disabled={!configured || status.isFetching || scheduler.isFetching}
        >
          <RefreshCw size={14} className={status.isFetching ? "spin" : ""} />
          {status.isFetching ? "Refreshing..." : "Refresh status"}
        </Button>
      </PageHeading>
      <section
        className="readiness-banner settings-readiness"
        aria-label="Workspace readiness"
      >
        <div className="settings-readiness-topline">
          <span className="settings-kicker">YOUR CONTROL PLANE</span>
          <span className="settings-private-label">
            <LockKeyhole size={12} /> Private workspace
          </span>
        </div>
        <div className="readiness-intro">
          <span className="readiness-shield">
            <ShieldCheck size={23} />
          </span>
          <div>
            <span className="eyebrow">ONE WORKSPACE. INDIVIDUAL ACCESS.</span>
            <h2>Your team works here. Your credentials stay private.</h2>
            <p>
              Every employee signs in with their own account and works within
              the permissions you grant.
            </p>
          </div>
        </div>
        <div className="readiness-checks">
          <div>
            <span className={`status-dot ${databaseVerified ? "" : "amber"}`} />
            <span>Database session</span>
            <strong>
              {databaseVerified
                ? "Verified"
                : status.isFetching
                  ? "Checking"
                  : "Not verified"}
            </strong>
          </div>
          <div>
            <span className={`status-dot ${ordersVerified ? "" : "amber"}`} />
            <span>Order synchronization</span>
            <strong>
              {status.isError
                ? "Status unavailable"
                : ordersVerified
                  ? "Local page saved"
                  : "Awaiting first sync"}
            </strong>
          </div>
          <div>
            <span
              className={`status-dot ${status.data?.messaging ? "" : "amber"}`}
            />
            <span>Buyer messaging</span>
            <strong>
              {status.data?.messaging ? "Connected" : "Manual replies"}
            </strong>
          </div>
        </div>
      </section>
      <div className="settings-grid">
        <EldoradoConnection configured={configured} />
        <section className="data-panel settings-section settings-control-card">
          <div className="settings-heading">
            <span className="settings-icon">
              <Database size={21} />
            </span>
            <div>
              <h2>Identity & database</h2>
              <p>Supabase PostgreSQL, Auth, and Row Level Security.</p>
            </div>
            <span
              className={`pill ${databaseVerified ? "pill-blue" : "pill-amber"}`}
            >
              {databaseVerified
                ? "Session verified"
                : configured
                  ? "Configuration present"
                  : "Setup required"}
            </span>
          </div>
          {databaseVerified ? (
            <div className="capability-list">
              <div>
                <span>Authenticated database access</span>
                <span className="pill pill-blue">Verified</span>
              </div>
              <div>
                <span>Staff access</span>
                <span>Individual accounts</span>
              </div>
              <div>
                <span>Privileged access</span>
                <span>Authenticator required</span>
              </div>
            </div>
          ) : (
            <ol className="setup-steps">
              <li>
                Create a Supabase project and apply the versioned migrations.
              </li>
              <li>
                Disable public sign-ups, configure SMTP and the invite
                confirmation template.
              </li>
              <li>
                Create your Owner account, run the documented one-time
                bootstrap, and enroll MFA.
              </li>
              <li>
                Configure the secure environment variables and restart the app.
              </li>
            </ol>
          )}
          <p className="scope-note">
            {databaseVerified
              ? "This status was returned by your authenticated database session. Access is enforced on the server and by database policies."
              : "Configuration presence does not prove connectivity. Database and authentication readiness require live validation."}
          </p>
        </section>
        <section className="data-panel settings-section settings-control-card">
          <div className="settings-heading">
            <span className="settings-icon">
              <KeyRound size={21} />
            </span>
            <div>
              <h2>Eldorado Seller API</h2>
              <p>
                Official API client credentials. Never your main account
                password.
              </p>
            </div>
          </div>
          <div className="capability-list">
            <div>
              <span>Order synchronization</span>
              <span
                className={`pill ${ordersVerified ? "pill-blue" : "pill-amber"}`}
              >
                {status.isError
                  ? "Status unavailable"
                  : ordersVerified
                    ? "Local snapshot available"
                    : status.data?.eldorado
                      ? "Ready for first sync"
                      : "Credentials required"}
              </span>
            </div>
            <div>
              <span>Offer synchronization</span>
              <span
                className={`pill ${offerSources.length ? "pill-blue" : "pill-muted"}`}
              >
                {status.isError
                  ? "Status unavailable"
                  : offerSources.length
                    ? `${offerSources.length} saved ${offerSources.length === 1 ? "source" : "sources"}`
                    : "Awaiting first sync"}
              </span>
            </div>
            <div>
              <span>Messaging</span>
              <span
                className={`pill ${status.data?.messaging ? "pill-blue" : "pill-amber"}`}
              >
                {status.data?.messaging
                  ? "Authorized provider connected"
                  : "Excluded from Seller API"}
              </span>
            </div>
            <div>
              <span>Individual listing pause / resume</span>
              <span
                className={`pill ${status.data?.availabilityActions ? "pill-blue" : "pill-muted"}`}
              >
                {!status.isError && status.data?.availabilityActions
                  ? "Available after synchronization"
                  : "Seller credentials required"}
              </span>
            </div>
            <div>
              <span>Predefined edits & eligible order actions</span>
              <span
                className={`pill ${status.data?.liveWrites ? "pill-blue" : "pill-muted"}`}
              >
                {!status.isError && status.data?.liveWrites
                  ? "Approval and MFA required"
                  : "Connect Seller API"}
              </span>
            </div>
          </div>
          <p>
            Client credentials are exchanged for a short-lived access token only
            on the server. Individual listing changes require permission,
            confirmation and a verified result from Eldorado.
          </p>
          <Button variant="outline" asChild>
            <a
              href="https://www.eldorado.gg/swagger/seller/index.html"
              target="_blank"
              rel="noreferrer"
            >
              Official Seller API documentation
              <ArrowUpRight size={13} />
            </a>
          </Button>
        </section>
        <section
          className="data-panel settings-section full-width settings-control-card"
          aria-label="Integration health"
          id="integration-health"
        >
          <div className="settings-heading">
            <span className="settings-icon">
              <RefreshCw size={21} />
            </span>
            <div>
              <h2>Integration health</h2>
              <p>
                Saved source pages, background processing and actions to resolve
                errors.
              </p>
            </div>
          </div>
          <p className="scope-note">
            These are local synchronization records, not a new live Eldorado
            connection test or a complete account crawl. Use Connect Eldorado to
            verify access; synchronize each source to refresh its data.
            {status.data?.integration &&
              !status.isError &&
              ` History checked ${new Date(status.data.integration.checkedAt).toLocaleString("en-US")}.`}
          </p>
          {status.isError ? (
            <QueryError message={status.error.message} />
          ) : status.data?.integration ? (
            <TableScroll label="Integration synchronization health">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Local status</th>
                    <th>Last successful sync</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {status.data.integration.sources.map((source) => (
                    <tr key={source.provider}>
                      <td>
                        <strong>{source.label}</strong>
                      </td>
                      <td>
                        <span
                          className={`pill ${source.state === "saved" ? "pill-blue" : "pill-amber"}`}
                        >
                          {source.state === "saved"
                            ? "Saved page"
                            : source.state === "attention"
                              ? "Needs attention"
                              : "Not synchronized"}
                        </span>
                      </td>
                      <td>
                        {source.lastSuccessAt
                          ? new Date(source.lastSuccessAt).toLocaleString(
                              "en-US",
                            )
                          : "No successful sync recorded"}
                      </td>
                      <td>
                        {source.lastSuccessAt
                          ? source.page
                            ? `Partial · page ${source.page.index} of ${source.page.totalPages} · ${source.page.recordCount} upstream records`
                            : source.provider === "eldorado"
                              ? `Partial · ${source.hasNextPage ? "more orders available" : "last page has no next cursor"}`
                              : "Partial · page metadata unavailable"
                          : "No saved coverage"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <p className="scope-note">
              {status.isFetching
                ? "Checking saved synchronization history…"
                : "Synchronization history is not available."}
            </p>
          )}
          {!status.isError &&
            status.data?.integration?.sources
              .filter((source) => source.issue)
              .map((source) => (
                <p className="scope-note" key={source.provider}>
                  <strong>
                    {source.label}: {source.issue!.title}.
                  </strong>{" "}
                  {source.issue!.action}{" "}
                  {source.lastErrorAt &&
                    `Recorded ${new Date(source.lastErrorAt).toLocaleString("en-US")}.`}
                </p>
              ))}
          <p className="scope-note">
            Only predefined offers support the verified page selector. Other
            offer adapters retain the verified initial-page scope.
          </p>
          <div className="capability-list">
            <div>
              <span>Background service</span>
              <strong>
                {scheduler.isError
                  ? "Status unavailable"
                  : (scheduler.data?.scheduler?.label ??
                    (scheduler.isFetching ? "Checking" : "Not checked"))}
              </strong>
            </div>
            {!scheduler.isError &&
              scheduler.data?.runtime?.provider_backoff_until && (
                <div>
                  <span>Provider cooldown recorded until</span>
                  <span>
                    {cooldownTime(
                      scheduler.data.runtime.provider_backoff_until,
                    )}
                  </span>
                </div>
              )}
            <div>
              <span>Last scheduler dispatch</span>
              <span>
                {scheduler.isError ||
                scheduler.data?.runtimeAccess === "unavailable"
                  ? "Status unavailable"
                  : scheduler.data?.runtimeAccess === "restricted"
                    ? "Details restricted"
                    : scheduler.data?.runtime?.last_dispatch_at
                      ? `${new Date(scheduler.data.runtime.last_dispatch_at).toLocaleString("en-US")} · ${scheduler.data.runtime.last_dispatch_status === null ? "transport result unavailable" : `HTTP ${scheduler.data.runtime.last_dispatch_status}`}`
                      : "No dispatch recorded"}
              </span>
            </div>
          </div>
          {scheduler.isError ? (
            <QueryError message={scheduler.error.message} />
          ) : (
            scheduler.data?.scheduler && (
              <p className="scope-note">{scheduler.data.scheduler.action}</p>
            )
          )}
          <Link href="/automation">
            Open scheduler and automation controls →
          </Link>
        </section>
        <section
          className="data-panel settings-section full-width settings-control-card"
          id="environment-bindings"
        >
          <div className="settings-heading">
            <span className="settings-icon">
              <LockKeyhole size={21} />
            </span>
            <div>
              <h2>Secure environment bindings</h2>
              <p>
                Set values in your hosting environment settings. Never paste
                secrets into chat.
              </p>
            </div>
          </div>
          <div className="variable-grid">
            {required.map((name) => (
              <button
                className="variable-row"
                key={name}
                onClick={() => copy(name)}
              >
                <code>{name}</code>
                {copied === name ? <Check size={13} /> : <Copy size={13} />}
              </button>
            ))}
          </div>
          <p className="scope-note">
            Optional: <code>INVENTORY_ENCRYPTION_KEY</code> is a locally
            available 32-byte key for encrypted inventory data. It must not be a
            proxy placeholder. <code>RIVOX_DEV_MOCKS=true</code> enables
            synthetic messaging only outside production.
          </p>
          {copied && (
            <span role="status" className="scope-note">
              {required.includes(copied)
                ? "Variable name copied. No value was accessed."
                : copied}
            </span>
          )}
        </section>
        <section className="data-panel settings-section settings-control-card">
          <div className="settings-heading">
            <span className="settings-icon">
              <MessageSquare size={21} />
            </span>
            <div>
              <h2>Official messaging access</h2>
              <p>Separate from the Seller API.</p>
            </div>
          </div>
          <p>
            Eldorado&apos;s Seller API supports offers and orders. Its official
            documentation excludes messages, disputes, and feedback from that
            API. Seller credentials alone cannot enable buyer replies here.
          </p>
          <p>
            The order&apos;s <code>talkJsConversationId</code> is a reference,
            not a messaging credential. A separate authorized integration must
            be confirmed with Eldorado before real conversations can be
            connected.
          </p>
          <Button variant="outline" asChild>
            <a
              href="https://support.eldorado.gg/en/articles/16127288-how-the-seller-api-works"
              target="_blank"
              rel="noreferrer"
            >
              Eldorado API capabilities <ArrowUpRight size={13} />
            </a>
          </Button>
        </section>
        <section className="data-panel settings-section settings-control-card">
          <div className="settings-heading">
            <span className="settings-icon">
              <Sparkles size={21} />
            </span>
            <div>
              <h2>AI Copilot</h2>
              <p>Not connected. Human approval remains the default.</p>
            </div>
          </div>
          <p>
            No buyer data is sent to an AI provider. A provider, privacy
            configuration, and data minimization policy must be approved before
            this module is enabled.
          </p>
          <div className="info-banner">
            <ShieldCheck size={15} />
            <span>
              No automatic delivery, cancellation, refund promises, or message
              sending.
            </span>
          </div>
        </section>
      </div>
      {!status.isError && status.data?.errors.length ? (
        <section className="data-panel settings-section settings-control-card">
          <h2>Recent integration errors</h2>
          {status.data.errors.map((error, index) => (
            <article key={index} className="detail-section">
              <strong>
                {error.title ?? "Integration check needs attention"}
              </strong>
              <p className="mono">
                {error.provider} · {error.code} ·{" "}
                {new Date(error.created_at).toLocaleString("en-US")}
              </p>
              {error.resolved ? (
                <p className="scope-note">
                  A later successful source sync is recorded. This entry remains
                  in the history.
                </p>
              ) : (
                <p className="scope-note">
                  {error.action ??
                    "Review connection health before retrying a read. Check outcomes of uncertain operations before resubmission."}
                </p>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
