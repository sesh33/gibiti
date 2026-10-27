"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { normalizeMfaQrCode } from "@/domains/authentication/mfa-qr";
export function AuthForm({
  mode,
  configured = true,
}: {
  mode: "login" | "mfa" | "password";
  configured?: boolean;
}) {
  const router = useRouter(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function setupMfa() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ factorId: string; qrCode?: string }>(
        "/api/auth/mfa",
        { method: "POST", body: JSON.stringify({ action: "setup" }) },
      );
      const qrCode = data.qrCode ? normalizeMfaQrCode(data.qrCode) : "";
      setQr(qrCode);
      setFactor(data.factorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start MFA.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        router.push("/inbox");
      } else if (mode === "password") {
        await api("/api/auth/password", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        router.push("/inbox");
      } else {
        await api("/api/auth/mfa", {
          method: "POST",
          body: JSON.stringify({ action: "verify", factorId: factor, code }),
        });
        router.push("/inbox");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === "login"
      ? "Welcome to your control room."
      : mode === "mfa"
        ? "A stronger layer of protection."
        : "Make this workspace yours.";
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
          <span className="eyebrow">SELLER OPERATIONS, REIMAGINED</span>
          <h1>
            Every detail.
            <br />
            Under <em>control.</em>
          </h1>
          <p>The workspace for people who take their operation seriously.</p>
          <div>
            <ShieldCheck size={16} /> Individual accounts. Deliberate
            permissions.
          </div>
        </div>
        <span className="auth-footnote">
          RIVOX CONTROL · PRIVATE OPERATIONS
        </span>
      </div>
      <section className="auth-panel">
        <span className="auth-lock">
          <LockKeyhole size={22} />
        </span>
        <h2>{title}</h2>
        <p>
          {mode === "login"
            ? "Sign in with your individual staff account."
            : mode === "mfa"
              ? "Owner and Admin accounts require a verified authenticator code."
              : "Set a strong, unique password for your invited account."}
        </p>
        {!configured ? (
          <div className="query-error">
            <strong>Authentication is not configured.</strong>
            <p>
              Configure Supabase, apply migrations, and bootstrap the Owner
              before signing in.
            </p>
            <Link href="/settings">View workspace setup</Link>
          </div>
        ) : (
          <>
            {mode === "mfa" && !factor && (
              <Button onClick={setupMfa} disabled={busy}>
                Set up or verify authenticator
                <ArrowRight size={14} />
              </Button>
            )}
            {qr && (
              <div className="qr-container">
                <img
                  src={qr}
                  width={200}
                  height={200}
                  alt="Authenticator enrollment QR code"
                />
                <p>
                  Scan with your authenticator app. Keep this enrollment
                  private.
                </p>
              </div>
            )}
            <form onSubmit={submit}>
              {mode === "login" && (
                <label className="field-label">
                  Work email
                  <input
                    autoComplete="username"
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                  />
                </label>
              )}
              {mode !== "mfa" && (
                <label className="field-label">
                  {mode === "password" ? "New password" : "Password"}
                  <input
                    autoComplete={
                      mode === "password" ? "new-password" : "current-password"
                    }
                    required
                    type="password"
                    minLength={mode === "password" ? 14 : 8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {mode === "mfa" && factor && (
                <label className="field-label">
                  Six-digit verification code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                  />
                </label>
              )}
              {(mode !== "mfa" || factor) && (
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Verifying..."
                    : mode === "login"
                      ? "Sign in securely"
                      : mode === "mfa"
                        ? "Verify and continue"
                        : "Save password"}
                  <ArrowRight size={15} />
                </Button>
              )}
            </form>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-security-note">
          <ShieldCheck size={13} />
          <span>Your Eldorado account password is never required here.</span>
        </div>
        <Link className="back-link" href="/settings">
          Workspace configuration
        </Link>
      </section>
    </main>
  );
}
