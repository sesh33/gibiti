"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

type AccountMode = "existing" | "create-local" | "verified-hosted";
type EmailStep = "email" | "verify" | "password";

export function OwnerSetup({
  enabled,
  localAccountCreation,
  temporaryHttps,
  hosted = false,
}: {
  enabled: boolean;
  localAccountCreation: boolean;
  temporaryHttps: boolean;
  hosted?: boolean;
}) {
  const router = useRouter();
  const fragmentInspected = useRef(false);
  const emailInvitation = useRef<{
    accessToken: string;
    refreshToken: string;
  } | null>(null);
  const [token, setToken] = useState(""),
    [privateLink, setPrivateLink] = useState(false),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [emailStep, setEmailStep] = useState<EmailStep>("email"),
    [emailLinkStatus, setEmailLinkStatus] = useState<
      "none" | "pending" | "verified"
    >("none"),
    [useEmailCode, setUseEmailCode] = useState(false),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [accountMode, setAccountMode] = useState<AccountMode>(
      hosted
        ? "verified-hosted"
        : localAccountCreation
          ? "create-local"
          : "existing",
    );
  const verifyingHostedEmail = hosted && accountMode === "verified-hosted";
  const showCredentials = !verifyingHostedEmail || emailStep === "password";

  useEffect(() => {
    if (fragmentInspected.current) return;
    fragmentInspected.current = true;
    async function readPrivateLink() {
      if (!window.location.hash) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      // Remove the capability before any request; keep it only in component memory.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      if (hosted && enabled && fragment.get("type") === "invite") {
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");
        if (accessToken && refreshToken) {
          emailInvitation.current = { accessToken, refreshToken };
          setEmailLinkStatus("pending");
          return;
        }
      }
      const supplied = fragment.get("setup");
      if (!enabled || !supplied || !/^[A-Za-z0-9_-]{43,128}$/.test(supplied))
        return;
      setToken(supplied);
      setPrivateLink(true);
    }
    void readPrivateLink();
  }, [enabled, hosted]);

  function changeMode(mode: AccountMode) {
    setAccountMode(mode);
    setEmailStep("email");
    setCode("");
    setUseEmailCode(false);
    setPassword("");
    setConfirm(false);
    setError("");
    setNotice("");
  }

  async function acceptEmailLink() {
    if (busy || !emailInvitation.current) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/setup/owner/email-session", {
        method: "POST",
        body: JSON.stringify(emailInvitation.current),
      });
      emailInvitation.current = null;
      setEmailLinkStatus("verified");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The email link could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueVerifiedEmail() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/setup/owner", {
        method: "POST",
        body: JSON.stringify({ action: "check-email", token, email }),
      });
      setEmailStep("password");
      setNotice(
        "Email verified. Choose your own password to create Owner access.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Your verified email session could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (verifyingHostedEmail && emailStep === "email") {
        await api("/api/setup/owner", {
          method: "POST",
          body: JSON.stringify({ action: "invite", token, email, confirm }),
        });
        setEmailStep("verify");
        setNotice(
          "Open the verification link in your email using this browser, accept it, then return to this private setup tab.",
        );
        return;
      }
      if (verifyingHostedEmail && emailStep === "verify") {
        await api("/api/setup/owner", {
          method: "POST",
          body: JSON.stringify(
            useEmailCode
              ? { action: "verify", token, email, code }
              : { action: "check-email", token, email },
          ),
        });
        setCode("");
        setEmailStep("password");
        setNotice(
          "Email verified. Choose your own password to create Owner access.",
        );
        return;
      }
      await api("/api/setup/owner", {
        method: "POST",
        body: JSON.stringify({
          action: "complete",
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

  const buttonLabel = busy
    ? "Verifying your account..."
    : verifyingHostedEmail && emailStep === "email"
      ? "Send verification email"
      : verifyingHostedEmail && emailStep === "verify"
        ? useEmailCode
          ? "Verify email code"
          : "I verified my email"
        : "Create Owner membership";

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
            <ShieldCheck size={16} /> Your identity. Your password. Protected by
            MFA.
          </div>
        </div>
        <span className="auth-footnote">
          {hosted
            ? "PRIVATE OWNER ACCESS · VERIFIED EMAIL · HTTPS"
            : temporaryHttps
              ? "TEMPORARY CLOUD ACCESS · HTTPS"
              : "LOCAL SETUP ONLY · NO PUBLIC SIGN-UP"}
        </span>
      </div>
      <section className="auth-panel">
        <span className="auth-lock">
          <LockKeyhole size={22} />
        </span>
        <h2>
          {emailLinkStatus !== "none"
            ? "Verify your email."
            : "Set up the first Owner."}
        </h2>
        <p>
          {hosted
            ? "Verify an email address you control, choose your password, then connect your authenticator. No installation is required."
            : "Authenticate an account you control to become the initial Owner. New-account creation is available only on the isolated local Auth service."}
        </p>
        {emailLinkStatus !== "none" ? (
          <div>
            {emailLinkStatus === "pending" ? (
              <>
                <p>
                  Accept this email verification, then return to the original
                  private setup tab. This step does not create Owner access.
                </p>
                <Button onClick={acceptEmailLink} disabled={busy}>
                  {busy ? "Verifying email..." : "Accept email verification"}
                </Button>
              </>
            ) : (
              <p role="status">
                Your email is verified in this browser. Return to the original
                private setup tab and select “I verified my email” to choose
                your password.
              </p>
            )}
          </div>
        ) : enabled ? (
          <form onSubmit={submit}>
            {(localAccountCreation || hosted) && (
              <label className="field-label">
                Account setup
                <select
                  value={accountMode}
                  disabled={busy}
                  onChange={(event) =>
                    changeMode(event.target.value as AccountMode)
                  }
                >
                  {hosted && (
                    <option value="verified-hosted">
                      Verify my email and create Owner access
                    </option>
                  )}
                  {localAccountCreation && (
                    <option value="create-local">
                      Create a new local account
                    </option>
                  )}
                  <option value="existing">
                    Use an existing verified account
                  </option>
                </select>
              </label>
            )}
            {privateLink ? (
              <div className="auth-security-note" role="status">
                <ShieldCheck size={13} />
                <span>
                  Private link loaded. Access will be verified when you submit.
                </span>
              </div>
            ) : (
              <label className="field-label">
                Private setup token
                <input
                  required
                  type="password"
                  autoComplete="off"
                  maxLength={256}
                  value={token}
                  disabled={busy}
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
            )}
            <label className="field-label">
              Account email
              <input
                required
                type="email"
                autoComplete="username"
                maxLength={254}
                value={email}
                disabled={
                  busy || (verifyingHostedEmail && emailStep !== "email")
                }
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {verifyingHostedEmail && emailStep === "verify" && (
              <>
                {useEmailCode && (
                  <label className="field-label">
                    Verification code
                    <input
                      required
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6,10}"
                      minLength={6}
                      maxLength={10}
                      value={code}
                      disabled={busy}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                )}
                <p className="auth-security-note">
                  Your email must be verified before any Owner membership is
                  created.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setUseEmailCode(!useEmailCode);
                    setCode("");
                    setError("");
                  }}
                >
                  {useEmailCode
                    ? "Use the email verification link"
                    : "My email includes a verification code"}
                </Button>
              </>
            )}
            {showCredentials && (
              <>
                <label className="field-label">
                  Display name
                  <input
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  Account password
                  <input
                    required
                    type="password"
                    autoComplete={
                      accountMode === "existing"
                        ? "current-password"
                        : "new-password"
                    }
                    minLength={accountMode === "existing" ? 8 : 14}
                    maxLength={128}
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="checkbox-label">
              <input
                required
                type="checkbox"
                checked={confirm}
                disabled={busy}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              I confirm this is my account and authorize this workspace setup,
              including email verification or account creation if selected.
            </label>
            <Button type="submit" disabled={busy || !confirm || !token}>
              {buttonLabel}
              <ArrowRight size={14} />
            </Button>
            {verifyingHostedEmail && emailStep === "email" && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !token || !email || !confirm}
                onClick={continueVerifiedEmail}
              >
                I already verified this email in this browser
              </Button>
            )}
            {verifyingHostedEmail && emailStep !== "email" && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => changeMode("verified-hosted")}
              >
                Use a different email or request another email
              </Button>
            )}
          </form>
        ) : (
          <div className="query-error">
            {hosted || temporaryHttps ? (
              <>
                <strong>Private Owner setup is unavailable or expired.</strong>
                <p>
                  Use a current private setup link. If you already created Owner
                  access, sign in with your email and password.
                </p>
              </>
            ) : (
              <>
                <strong>Private local setup is not enabled.</strong>
                <p>
                  On your computer, configure the secure environment and run:
                </p>
                <p>
                  <code>node scripts/start-owner-setup.mjs</code>
                </p>
                <p>
                  The launcher creates a private temporary token file and starts
                  a loopback-only setup session for 30 minutes. It does not
                  create an Auth user or alter existing data automatically.
                </p>
              </>
            )}
          </div>
        )}
        {notice && (
          <p className="inline-feedback" role="status">
            {notice}
          </p>
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
