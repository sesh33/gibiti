"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function InventoryActions({
  item,
}: {
  item: {
    id: string;
    status: string;
    inventory_reservations: { id: string; released_at: string | null }[];
  };
}) {
  const cache = useQueryClient(),
    [mode, setMode] = useState<"release" | "consume" | "reveal" | null>(null),
    [reason, setReason] = useState(""),
    [key, setKey] = useState(""),
    [secret, setSecret] = useState("");
  const revealRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      revealRequest.current?.abort();
    },
    [],
  );
  const access = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
  });
  const reservation = item.inventory_reservations.find(
    (entry) => !entry.released_at,
  );
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (mode === "reveal") {
        const controller = new AbortController();
        revealRequest.current = controller;
        const data = await api<{ value: string }>("/api/inventory/reveal", {
          method: "POST",
          body: JSON.stringify({ item: item.id }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setSecret(data.value);
        return { revealed: true };
      }
      return api(
        mode === "consume"
          ? "/api/inventory/consume-request"
          : "/api/inventory/finish",
        {
          method: "POST",
          body: JSON.stringify({
            reservation: reservation?.id,
            consume: false,
            reason,
            idempotencyKey: key,
          }),
        },
      );
    },
    onSuccess: () => {
      if (mode !== "reveal") {
        setMode(null);
        cache.invalidateQueries({ queryKey: ["inventory"] });
        cache.invalidateQueries({ queryKey: ["approvals"] });
      }
    },
  });
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(""), 30000);
    return () => clearTimeout(timer);
  }, [secret]);
  function open(next: typeof mode) {
    mutation.reset();
    setMode(next);
    setReason("");
    setSecret("");
    setKey(crypto.randomUUID());
  }
  const canManage = access.data?.permissions.includes("inventory.manage"),
    canReveal = access.data?.permissions.includes("inventory.secrets.read");
  return (
    <>
      <div className="inventory-actions">
        {reservation && canManage && (
          <>
            <Button size="sm" variant="ghost" onClick={() => open("release")}>
              <RotateCcw size={12} />
              Release
            </Button>
            <Button size="sm" variant="ghost" onClick={() => open("consume")}>
              <ShieldCheck size={12} />
              Request consumption
            </Button>
          </>
        )}
        {canReveal && (
          <Button size="sm" variant="ghost" onClick={() => open("reveal")}>
            <Eye size={12} />
            Delivery data
          </Button>
        )}
      </div>
      <Dialog
        open={Boolean(mode)}
        onOpenChange={(value) => {
          if (!value) {
            revealRequest.current?.abort();
            setMode(null);
            setSecret("");
          }
        }}
      >
        <DialogContent>
          <DialogTitle>
            {mode === "reveal"
              ? "Protected delivery data"
              : mode === "release"
                ? "Release internal reservation"
                : "Request inventory consumption"}
          </DialogTitle>
          <DialogDescription>
            {mode === "reveal"
              ? "Access is permission-checked, assignment-scoped, and audited. Revealed data is cleared after 30 seconds or when you close this dialog."
              : mode === "release"
                ? "This makes the internal item available again. It does not change or cancel the Eldorado order."
                : "A distinct authorized reviewer must approve consumption. This only changes internal stock and never marks the Eldorado order delivered."}
          </DialogDescription>
          {mode === "reveal" ? (
            secret ? (
              <pre className="revealed-secret">{secret}</pre>
            ) : (
              <Button
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                Reveal authorized delivery data
              </Button>
            )
          ) : (
            <>
              <label className="field-label">
                Reason
                <textarea
                  value={reason}
                  maxLength={2000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <Button
                disabled={
                  mutation.isPending ||
                  reason.trim().length < (mode === "consume" ? 10 : 3)
                }
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending
                  ? "Saving..."
                  : mode === "consume"
                    ? "Submit approval request"
                    : "Confirm release"}
              </Button>
            </>
          )}
          {mutation.isError && (
            <p role="alert" className="form-error">
              {mutation.error.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
