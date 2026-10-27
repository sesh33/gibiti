"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function OwnerSetup({
  enabled,
  localAccountCreation,
}: {
  enabled: boolean;
  localAccountCreation: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [accountMode, setAccountMode] = useState<"existing" | "create-local">(
      localAccountCreation ? "create-local" : "existing",
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/setup/owner", {
        method: "POST",
        body: JSON.stringify({
          token,
          email,
          password,
          name,
          confirm,
          accountMode,
        }),
      });
      setToken("");
      setPassword("");
      router.push("/mfa");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Owner setup could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-art">
        <Link href="/" className="wordmark">
          <span className="brand-symbol">
            <Zap size={20} fill="currentColor" />
          </span>
          RIVOX<span className="wordmark-sub">CONTROL</span>
        </Link>
        <div className="auth-manifesto">
          <span className="eyebrow">PRIVATE FIRST-RUN SETUP</span>
          <h1>
            Your workspace.
            <br />
            Your <em>control.</em>
          </h1>
          <p>
            Create the first staff membership without opening public Owner
            registration.
          </p>
          <div>
            <ShieldCheck size={16} /> A verified account. A private setup token.
          </div>
        </div>
        <span className="auth-footnote">
          LOCAL SETUP ONLY · NO PUBLIC SIGN-UP
        </span>
      </div>
      <section className="auth-panel">
        <span className="auth-lock">
          <LockKeyhole size={22} />
        </span>
        <h2>Set up the first Owner.</h2>
        <p>
          Authenticate an account you control to become the initial Owner.
          New-account creation is available only on the isolated local Auth
          service.
        </p>
        {enabled ? (
          <form onSubmit={submit}>
            {localAccountCreation && (
              <label className="field-label">
                Account setup
                <select
                  value={accountMode}
                  onChange={(event) =>
                    setAccountMode(
                      event.target.value as "existing" | "create-local",
                    )
                  }
                >
                  <option value="create-local">
                    Create a new local account
                  </option>
                  <option value="existing">
                    Use an existing verified account
                  </option>
                </select>
              </label>
            )}
            <label className="field-label">
              Private setup token
              <input
                required
                type="password"
                autoComplete="off"
                maxLength={256}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <label className="field-label">
              Display name
              <input
                required
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              Account email
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field-label">
              Account password
              <input
                required
                type="password"
                autoComplete="current-password"
                minLength={accountMode === "create-local" ? 14 : 8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                required
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              I confirm this is my account and authorize this local setup,
              including account creation if selected.
            </label>
            <Button type="submit" disabled={busy || !confirm}>
              {busy ? "Verifying your account..." : "Create Owner membership"}
              <ArrowRight size={14} />
            </Button>
          </form>
        ) : (
          <div className="query-error">
            <strong>Private local setup is not enabled.</strong>
            <p>On your computer, configure the secure environment and run:</p>
            <p>
              <code>node scripts/start-owner-setup.mjs</code>
            </p>
            <p>
              The launcher creates a private temporary token file and starts a
              loopback-only setup session for 30 minutes. It does not create an
              Auth user or alter existing data automatically.
            </p>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-security-note">
          <ShieldCheck size={13} />
          <span>
            Setup closes after the first Owner. MFA is required before workspace
            access.
          </span>
        </div>
        <Link className="back-link" href="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
