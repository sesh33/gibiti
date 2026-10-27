"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHeading } from "@/components/page-heading";
import { EmptyState, QueryError } from "@/components/empty-state";
import type { OrderRow } from "./order-center";
type Detail = OrderRow & {
  delivery_time: string | null;
  delivery_method: string | null;
  details: {
    description?: string;
    dispute?: { reason?: string; message?: string };
    cancelation?: { reason?: string; message?: string };
  };
  order_state_history: { id: string; state: string; occurred_at: string }[];
  internal_notes: {
    id: string;
    body: string;
    created_at: string;
    author_id: string;
  }[];
  order_assignments: { user_id: string }[];
};
export function OrderDetail({
  id,
  configured,
}: {
  id: string;
  configured: boolean;
}) {
  const cache = useQueryClient(),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [action, setAction] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [requestKey, setRequestKey] = useState(""),
    [assignee, setAssignee] = useState("");
  const detail = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<{ order: Detail }>(`/api/orders/${id}`),
    enabled: configured,
  });
  const noteMutation = useMutation({
    mutationFn: () =>
      api(`/api/orders/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      }),
    onSuccess: () => {
      setNote("");
      cache.invalidateQueries({ queryKey: ["order", id] });
      setNotice("Internal note saved. It was not sent to the buyer.");
    },
    onError: (e) => setNotice(e.message),
  });
  const approval = useMutation({
    mutationFn: () =>
      api("/api/approvals", {
        method: "POST",
        body: JSON.stringify({
          action,
          target: id,
          reason,
          idempotencyKey: requestKey,
        }),
      }),
    onSuccess: () => {
      setAction(null);
      setReason("");
      setNotice(
        "Approval requested. No external order action has been executed.",
      );
    },
    onError: (e) => setNotice(e.message),
  });
  const assignment = useMutation({
    mutationFn: () =>
      api(`/api/orders/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ employee: assignee }),
      }),
    onSuccess: () => {
      setNotice("Order assignment updated.");
      cache.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e) => setNotice(e.message),
  });
  const team = useQuery({
    queryKey: ["team-for-assignment"],
    queryFn: () =>
      api<{ items: { id: string; display_name: string; active: boolean }[] }>(
        "/api/team",
      ),
    enabled: configured,
    retry: false,
  });
  const order = detail.data?.order;
  function request(action: string) {
    setAction(action);
    setReason("");
    setRequestKey(crypto.randomUUID());
  }
  return (
    <>
      <Link className="back-link" href="/orders">
        <ArrowLeft size={13} />
        Order center
      </Link>
      <PageHeading
        eyebrow="ORDER WORKSPACE"
        title={order?.buyer_username ?? "Order details"}
        description={id}
      />
      {notice && (
        <p role="status" className="inline-feedback">
          {notice}
        </p>
      )}
      {detail.isError ? (
        <QueryError message={detail.error.message} />
      ) : !order ? (
        <EmptyState
          title={configured ? "Loading order..." : "Secure access required"}
          description="Order data is available only to authenticated staff with the required permissions."
        />
      ) : (
        <div className="detail-grid">
          <section className="data-panel detail-main">
            <div className="panel-title">
              <h2>{order.product_title}</h2>
              <span className="state-badge">{order.state}</span>
            </div>
            <div className="detail-summary">
              {[
                ["Total", money(Number(order.amount), order.currency)],
                ["Quantity", String(order.quantity)],
                [
                  "Purchased",
                  new Date(order.purchased_at).toLocaleString("en-US"),
                ],
                ["Delivery method", order.delivery_method ?? "Not provided"],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="detail-section">
              <h3>Product & delivery</h3>
              <p className="preserve-lines">
                {order.details.description ??
                  "No product description was provided."}
              </p>
              <p>Delivery time: {order.delivery_time ?? "Not provided"}</p>
              <p>
                Conversation reference:{" "}
                {order.conversation_ref ?? "Not provided"}
              </p>
            </div>
            {order.details.dispute && (
              <div className="detail-section">
                <h3>Dispute</h3>
                <p>{order.details.dispute.reason}</p>
                <p>{order.details.dispute.message}</p>
              </div>
            )}
            {order.details.cancelation && (
              <div className="detail-section">
                <h3>Cancellation</h3>
                <p>{order.details.cancelation.reason}</p>
                <p>{order.details.cancelation.message}</p>
              </div>
            )}
            <div className="detail-section">
              <h3>State history</h3>
              <div className="timeline">
                {[...order.order_state_history]
                  .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
                  .map((log) => (
                    <div key={log.id}>
                      <CheckCircle2 size={13} />
                      <strong>{log.state}</strong>
                      <time>
                        {new Date(log.occurred_at).toLocaleString("en-US")}
                      </time>
                    </div>
                  ))}
              </div>
            </div>
            <div className="detail-section">
              <h3>
                <FileText size={14} />
                Internal notes
              </h3>
              <p>Visible only to authorized staff. Never sent to the buyer.</p>
              {order.internal_notes.map((note) => (
                <div className="internal-note" key={note.id}>
                  <p>{note.body}</p>
                  <small>
                    {new Date(note.created_at).toLocaleString("en-US")}
                  </small>
                </div>
              ))}
              <textarea
                aria-label="Internal note"
                placeholder="Add a private operational note..."
                value={note}
                maxLength={5000}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!note.trim() || noteMutation.isPending}
                onClick={() => noteMutation.mutate()}
              >
                Save internal note
              </Button>
            </div>
          </section>
          <aside>
            <section className="data-panel action-panel">
              <h3>
                <ShieldCheck size={15} />
                Controlled actions
              </h3>
              <p>
                Requests are reviewed before execution. Live delivery and
                cancellation are not enabled until their official contracts are
                verified.
              </p>
              <Button
                variant="outline"
                onClick={() => request("orders.deliver")}
              >
                <CheckCircle2 size={14} />
                Request delivery
              </Button>
              <Button
                variant="outline"
                onClick={() => request("orders.update_delivery")}
              >
                Request delivery update
              </Button>
              <Button
                variant="destructive"
                onClick={() => request("orders.cancel")}
              >
                <XCircle size={14} />
                Request cancellation
              </Button>
            </section>
            <section className="data-panel action-panel">
              <h3>
                <UserRound size={14} />
                Order ownership
              </h3>
              <p>
                {order.order_assignments.length
                  ? `Assigned to ${order.order_assignments[0].user_id}`
                  : "No employee assigned."}
              </p>
              <select
                aria-label="Assign employee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Select employee</option>
                {team.data?.items
                  .filter((u) => u.active)
                  .map((u) => (
                    <option value={u.id} key={u.id}>
                      {u.display_name}
                    </option>
                  ))}
              </select>
              <Button
                variant="outline"
                disabled={!assignee || assignment.isPending}
                onClick={() => assignment.mutate()}
              >
                Assign order
              </Button>
            </section>
          </aside>
        </div>
      )}
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !approval.isPending) setAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Request operational approval</DialogTitle>
          <DialogDescription>
            This creates an audited request only. It does not change the order
            in Eldorado. A different authorized reviewer must decide.
          </DialogDescription>
          <label className="field-label">
            Action
            <input readOnly value={action ?? ""} />
          </label>
          <label className="field-label">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              placeholder="Explain why this action is needed (at least 10 characters)."
            />
          </label>
          <Button
            disabled={reason.trim().length < 10 || approval.isPending}
            onClick={() => approval.mutate()}
          >
            {approval.isPending ? "Submitting..." : "Confirm approval request"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
