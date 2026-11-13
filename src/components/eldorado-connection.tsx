"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function EldoradoConnection({ configured }: { configured: boolean }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ profile: { role: string } }>("/api/me"),
    enabled: configured,
    retry: false,
  });
  const isOwner = me.data?.profile?.role === "OWNER";
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<{
    checkedAt: string;
    checks: {
      name: string;
      ok: boolean;
      code?: string;
      value?: number | { unread: number; hasMore: boolean };
    }[];
  } | null>(null);
  const connection = useQuery({
    queryKey: ["eldorado-connection"],
    queryFn: () =>
      api<{
        configured: boolean;
        clientId: string | null;
        verifiedAt: string | null;
        verifiedOrigin?: string | null;
      }>("/api/integrations/eldorado"),
    enabled: isOwner,
    retry: false,
  });
  if (!isOwner) return null;
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = JSON.stringify({
      clientSecret: new FormData(form).get("clientSecret"),
    });
    // Keep the secret out of React state and all query/mutation caches.
    form.reset();
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await api<{ message: string }>(
        "/api/integrations/eldorado",
        { method: "POST", body, cache: "no-store" },
      );
      setMessage(result.message);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["settings"] }),
        connection.refetch(),
      ]);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Connection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verifyFromThisServer() {
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const result = await api<{ message: string }>(
        "/api/integrations/eldorado",
        { method: "POST", body: JSON.stringify({ action: "verify" }) },
      );
      setMessage(result.message);
      await connection.refetch();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The connection could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkHealth() {
    setChecking(true);
    setMessage("");
    setFailed(false);
    try {
      setHealth(
        await api("/api/integrations/eldorado/health", {
          method: "POST",
          body: "{}",
          cache: "no-store",
        }),
      );
    } catch (error) {
      setHealth(null);
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Status could not be checked.",
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="data-panel settings-section full-width">
      <div className="settings-heading">
        <span className="settings-icon">
          <KeyRound size={21} />
        </span>
        <div>
          <h2>Connect Eldorado</h2>
          <p>Owner access only. Employees never receive this credential.</p>
        </div>
        <span
          className={`pill ${connection.data?.configured ? "pill-blue" : "pill-amber"}`}
        >
          {connection.data?.configured ? "Configured" : "Connection required"}
        </span>
      </div>
      {connection.isError ? (
        <p role="alert">{connection.error.message}</p>
      ) : connection.isPending ? (
        <p role="status">Checking connection settings…</p>
      ) : (
        <>
          <p className="scope-note">
            Client ID:{" "}
            <code>
              {connection.data.clientId ?? "Missing server configuration"}
            </code>
          </p>
          {connection.data.verifiedAt && (
            <p className="scope-note">
              Last successful connection check:{" "}
              {new Date(connection.data.verifiedAt).toLocaleString()}
            </p>
          )}
          {connection.data.verifiedOrigin && (
            <p className="scope-note">
              Verified by server: {connection.data.verifiedOrigin}
            </p>
          )}
          {connection.data.configured && (
            <Button
              variant="outline"
              onClick={verifyFromThisServer}
              disabled={busy}
            >
              Verify saved connection from this server
            </Button>
          )}
          <form
            className="connection-form"
            onSubmit={connect}
            autoComplete="off"
          >
            <label className="field-label">
              Eldorado client secret
              <input
                name="clientSecret"
                type="password"
                autoComplete="off"
                required
                minLength={10}
                maxLength={512}
                spellCheck={false}
                disabled={busy || !connection.data.clientId}
                placeholder="Paste your Seller API client secret"
              />
            </label>
            <Button type="submit" disabled={busy || !connection.data.clientId}>
              <ShieldCheck size={15} />
              {busy
                ? "Checking and saving…"
                : connection.data.configured
                  ? "Verify & replace connection"
                  : "Verify & connect"}
            </Button>
          </form>
          <p className="scope-note">
            The check reads orders without changing them. The secret is
            encrypted on the server and cannot be displayed again.
          </p>
          {connection.data.configured && (
            <div className="seller-health">
              <Button
                variant="outline"
                onClick={checkHealth}
                disabled={checking || busy}
              >
                {checking ? "Checking seller status…" : "Check seller status"}
              </Button>
              <p className="scope-note">
                Read-only counts from Eldorado: notifications, orders awaiting
                review and restriction entries. Open Eldorado for details or
                actions.
              </p>
              {health && (
                <>
                  <div className="capability-list">
                    {health.checks.map((check) => (
                      <div key={check.name}>
                        <span>
                          {check.name === "notifications"
                            ? "Unread notifications"
                            : check.name === "pendingReviews"
                              ? "Orders awaiting review"
                              : "Restriction entries"}
                        </span>
                        <strong>
                          {!check.ok
                            ? `Unavailable (${check.code})`
                            : typeof check.value === "number"
                              ? check.value
                              : check.value
                                ? `${check.value.unread}${check.value.hasMore ? "+" : ""}`
                                : "Unavailable"}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <p className="scope-note">
                    Checked at {new Date(health.checkedAt).toLocaleTimeString()}
                    . No marketplace action was performed.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    </section>
  );
}
