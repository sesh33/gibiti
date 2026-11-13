"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import {
  changeLabels,
  type MarketplaceChange,
} from "@/domains/eldorado/contracts";
export function MarketplaceExecution({
  operation,
}: {
  operation: {
    id: string;
    status: string;
    target_id: string;
    payload: {
      marketV1?: boolean;
      change?: MarketplaceChange;
      before?: unknown;
    } | null;
  };
}) {
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const cache = useQueryClient(),
    check = ["blocked", "executing"].includes(operation.status);
  if (
    !operation.payload?.marketV1 ||
    !operation.payload.change ||
    (!check && operation.status !== "approved")
  )
    return notice ? (
      <p role="status" className="scope-note">
        {notice}
      </p>
    ) : null;
  async function execute() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ message: string }>(
        `/api/marketplace/requests/${operation.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: check ? "check" : "execute",
            confirm: true,
          }),
        },
      );
      setNotice(result.message);
      setOpen(false);
      await Promise.all(
        [
          "approvals",
          "offers",
          "offer-edit",
          "order",
          "orders",
          "settings",
        ].map((name) => cache.invalidateQueries({ queryKey: [name] })),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Check this operation's status before doing anything else.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setConfirmed(false);
          setOpen(true);
        }}
      >
        {check ? "Check outcome" : "Execute approved change"}
      </Button>
      {notice && (
        <p role="status" className="scope-note">
          {notice}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {check ? "Check recorded outcome" : "Confirm marketplace execution"}
          </DialogTitle>
          <DialogDescription>
            {check
              ? "This reads current data. It never sends the change again."
              : "This sends the exact approved request to Eldorado. Execution requires MFA and current permission. Verify the target and values."}
          </DialogDescription>
          {!check && (
            <p className="scope-note">
              <Link href="/mfa">Verify your authenticator</Link> before
              execution.
            </p>
          )}
          <div className="review-summary">
            <strong>{changeLabels[operation.payload.change.kind]}</strong>
            <code>{operation.target_id}</code>
          </div>
          <pre className="market-json">
            {JSON.stringify(operation.payload.change, null, 2)}
          </pre>
          {!check && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I confirm this exact target and approved change. For delivery, I
              have completed and verified the actual transfer.
            </label>
          )}
          <Button disabled={busy || (!check && !confirmed)} onClick={execute}>
            {busy
              ? "Checking operation…"
              : check
                ? "Read current status"
                : "Execute this approved request once"}
          </Button>
          {notice && <p role="alert">{notice}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
