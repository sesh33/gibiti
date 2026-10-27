"use client";
import { useEffect, useRef, useState } from "react";
import { AuthForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
type Invitation =
  | { kind: "hash"; tokenHash: string }
  | { kind: "session"; accessToken: string; refreshToken: string };
export function InviteSession() {
  const invitation = useRef<Invitation | null>(null);
  const inspected = useRef(false);
  const [status, setStatus] = useState<
      "loading" | "pending" | "ready" | "error"
    >("loading"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (inspected.current) return;
    inspected.current = true;
    async function readInvitation() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (!window.location.hash) {
        setStatus("ready");
        return;
      }
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      if (hash.get("type") !== "invite") {
        setError(
          "This invitation link is not supported. Request a new invitation.",
        );
        setStatus("error");
        return;
      }
      if (hash.get("token_hash"))
        invitation.current = {
          kind: "hash",
          tokenHash: hash.get("token_hash")!,
        };
      else if (hash.get("access_token") && hash.get("refresh_token"))
        invitation.current = {
          kind: "session",
          accessToken: hash.get("access_token")!,
          refreshToken: hash.get("refresh_token")!,
        };
      else {
        setError("This invitation is incomplete. Request a new invitation.");
        setStatus("error");
        return;
      }
      setStatus("pending");
    }
    void readInvitation();
  }, []);
  async function accept() {
    if (!invitation.current || busy) return;
    setBusy(true);
    try {
      await api("/api/auth/invite-session", {
        method: "POST",
        body: JSON.stringify(invitation.current),
      });
      invitation.current = null;
      setStatus("ready");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The invitation could not be verified.",
      );
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }
  if (status === "ready") return <AuthForm mode="password" />;
  return (
    <main className="standalone">
      <span className="eyebrow">RIVOX CONTROL / STAFF INVITATION</span>
      <h1>
        {status === "loading"
          ? "Preparing your invitation…"
          : "Accept your staff invitation."}
      </h1>
      <p>
        Continue to verify this invitation and choose your own staff password.
      </p>
      {status === "pending" && (
        <Button onClick={accept} disabled={busy}>
          {busy ? "Verifying invitation…" : "Accept invitation"}
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
