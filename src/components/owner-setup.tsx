"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function OwnerSetup({
  enabled,
  localAccountCreation,
  temporaryHttps,
}: {
  enabled: boolean;
  localAccountCreation: boolean;
  temporaryHttps: boolean;
}) {
  const router = useRouter();
  const fragmentInspected = useRef(false);
  const [token, setToken] = useState(""),
    [privateLink, setPrivateLink] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [accountMode, setAccountMode] = useState<"existing" | "create-local">(
      localAccountCreation ? "create-local" : "existing",
    );
  useEffect(() => {
    if (fragmentInspected.current) return;
    fragmentInspected.current = true;
    async function readPrivateLink() {
      if (!window.location.hash) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      // The capability never enters an HTTP URL, browser storage, or server-rendered props.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      const supplied = fragment.get("setup");
      if (!enabled || !supplied || !/^[A-Za-z0-9_-]{43,128}$/.test(supplied))
        return;
      setToken(supplied);
      setPrivateLink(true);
    }
    void readPrivateLink();
  }, [enabled]);
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
          <span className="eyebrow">
            {temporaryHttps
              ? "PRIMEIRO ACESSO PRIVADO"
              : "PRIVATE FIRST-RUN SETUP"}
          </span>
          <h1>
            {temporaryHttps ? "Seu espaço." : "Your workspace."}
            <br />
            {temporaryHttps ? "Seu " : "Your "}
            <em>{temporaryHttps ? "controle." : "control."}</em>
          </h1>
          <p>
            {temporaryHttps
              ? "O ambiente já está rodando. Escolha sua conta e sua senha para assumir o controle."
              : "Create the first staff membership without opening public Owner registration."}
          </p>
          <div>
            <ShieldCheck size={16} />{" "}
            {temporaryHttps
              ? "Link privado. Senha sua. Acesso com MFA."
              : "A verified account. A private setup token."}
          </div>
        </div>
        <span className="auth-footnote">
          {temporaryHttps
            ? "ACESSO TEMPORÁRIO NA NUVEM · HTTPS"
            : "LOCAL SETUP ONLY · NO PUBLIC SIGN-UP"}
        </span>
      </div>
      <section className="auth-panel">
        <span className="auth-lock">
          <LockKeyhole size={22} />
        </span>
        <h2>
          {temporaryHttps
            ? "Crie seu acesso ao RIVOX."
            : "Set up the first Owner."}
        </h2>
        <p>
          {temporaryHttps
            ? "Você será o primeiro Owner deste ambiente privado. Depois, confirme seu autenticador para entrar. Nenhuma instalação é necessária."
            : "Authenticate an account you control to become the initial Owner. New-account creation is available only on the isolated local Auth service."}
        </p>
        {enabled ? (
          <form onSubmit={submit}>
            {localAccountCreation && (
              <label className="field-label">
                {temporaryHttps ? "Conta" : "Account setup"}
                <select
                  value={accountMode}
                  onChange={(event) =>
                    setAccountMode(
                      event.target.value as "existing" | "create-local",
                    )
                  }
                >
                  <option value="create-local">
                    {temporaryHttps
                      ? "Criar minha conta neste ambiente"
                      : "Create a new local account"}
                  </option>
                  <option value="existing">
                    {temporaryHttps
                      ? "Usar conta já existente neste ambiente"
                      : "Use an existing verified account"}
                  </option>
                </select>
              </label>
            )}
            {privateLink ? (
              <div className="auth-security-note" role="status">
                <ShieldCheck size={13} />
                <span>
                  {temporaryHttps
                    ? "Acesso privado carregado. Será validado ao criar sua conta."
                    : "Private link loaded. Access will be verified when you submit."}
                </span>
              </div>
            ) : (
              <label className="field-label">
                {temporaryHttps
                  ? "Token de acesso privado"
                  : "Private setup token"}
                <input
                  required
                  type="password"
                  autoComplete="off"
                  maxLength={256}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            )}
            <label className="field-label">
              {temporaryHttps ? "Seu nome" : "Display name"}
              <input
                required
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              {temporaryHttps ? "Seu e-mail" : "Account email"}
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field-label">
              {temporaryHttps ? "Sua senha" : "Account password"}
              <input
                required
                type="password"
                autoComplete={
                  accountMode === "create-local"
                    ? "new-password"
                    : "current-password"
                }
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
              {temporaryHttps
                ? "Confirmo que esta conta é minha e autorizo a criação do meu acesso privado neste ambiente."
                : "I confirm this is my account and authorize this local setup, including account creation if selected."}
            </label>
            <Button type="submit" disabled={busy || !confirm}>
              {temporaryHttps
                ? busy
                  ? "Preparando seu acesso..."
                  : "Criar meu acesso"
                : busy
                  ? "Verifying your account..."
                  : "Create Owner membership"}
              <ArrowRight size={14} />
            </Button>
          </form>
        ) : (
          <div className="query-error">
            {temporaryHttps ? (
              <>
                <strong>Este acesso privado não está disponível.</strong>
                <p>
                  Use um link privado válido para criar sua conta. Se você já
                  criou seu acesso, entre com seu e-mail e sua senha.
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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-security-note">
          <ShieldCheck size={13} />
          <span>
            {temporaryHttps
              ? "Este acesso fecha após o primeiro Owner. O autenticador é obrigatório para entrar."
              : "Setup closes after the first Owner. MFA is required before workspace access."}
          </span>
        </div>
        <Link className="back-link" href="/login">
          {temporaryHttps ? "Já tenho uma conta" : "Back to sign in"}
        </Link>
      </section>
    </main>
  );
}
