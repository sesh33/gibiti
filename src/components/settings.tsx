"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Copy,
  Database,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { QueryError } from "@/components/empty-state";
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
        messaging: boolean;
        database: boolean;
        liveWrites: boolean;
        errors: { provider: string; code: string; created_at: string }[];
      }>("/api/workspace/settings"),
    enabled: configured,
  });
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied("Clipboard unavailable; select the variable name to copy it.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE CONFIGURATION"
        title="Connected carefully. Controlled completely."
        description="Server-side credentials, explicit capabilities, and a clear integration status."
      />
      <div className="settings-grid">
        <section className="data-panel settings-section">
          <div className="settings-heading">
            <span className="settings-icon">
              <Database size={21} />
            </span>
            <div>
              <h2>Identity & database</h2>
              <p>Supabase PostgreSQL, Auth, and Row Level Security.</p>
            </div>
            <span className={`pill ${configured ? "pill-blue" : "pill-amber"}`}>
              {configured ? "Configuration present" : "Setup required"}
            </span>
          </div>
          <ol className="setup-steps">
            <li>
              Create a Supabase project and apply the versioned migrations.
            </li>
            <li>
              Disable public sign-ups, configure SMTP and the invite
              confirmation template.
            </li>
            <li>
              Create your Owner account, run the documented one-time bootstrap,
              and enroll MFA.
            </li>
            <li>
              Configure the secure environment variables and restart the app.
            </li>
          </ol>
          <p className="scope-note">
            Configuration presence does not prove connectivity. Database and
            authentication readiness require live validation.
          </p>
        </section>
        <section className="data-panel settings-section">
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
              <span className="pill pill-amber">
                {status.data?.eldorado
                  ? "Credentials present · unverified"
                  : "Credentials required"}
              </span>
            </div>
            <div>
              <span>Messaging</span>
              <span className="pill pill-amber">
                Awaiting authorized access
              </span>
            </div>
            <div>
              <span>Live order / offer writes</span>
              <span className="pill pill-muted">
                Contract verification required
              </span>
            </div>
          </div>
          <p>
            Client credentials are exchanged for a short-lived access token only
            on the server. The token is renewed before expiration. No real
            mutation is performed during setup.
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
        <section className="data-panel settings-section full-width">
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
        <section className="data-panel settings-section">
          <div className="settings-heading">
            <span className="settings-icon">
              <MessageSquare size={21} />
            </span>
            <div>
              <h2>Official messaging access</h2>
              <p>Blocked by external authorization.</p>
            </div>
          </div>
          <p>
            The order's <code>talkJsConversationId</code> is a reference, not a
            credential. An authorized Eldorado messaging contract or provisioned
            SDK access is required before reading or sending real messages.
          </p>
          <p>
            Ask Eldorado support whether seller messaging APIs, scoped TalkJS
            credentials, or message webhooks are available. No browser cookies
            or undocumented endpoints are used.
          </p>
        </section>
        <section className="data-panel settings-section">
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
      {status.isError && <QueryError message={status.error.message} />}{" "}
      {status.data?.errors.length ? (
        <section className="data-panel settings-section">
          <h2>Recent integration errors</h2>
          {status.data.errors.map((error, index) => (
            <p className="mono" key={index}>
              {error.provider} · {error.code} ·{" "}
              {new Date(error.created_at).toLocaleString("en-US")}
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}
