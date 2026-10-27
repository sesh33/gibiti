"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCheck,
  FileText,
  Headphones,
  Keyboard,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  chronologicalMessages,
  filterConversations,
  parseInboxView,
  mayHandleInboxShortcut,
  type InboxFilter,
  type InboxStatus,
} from "@/domains/messaging/inbox-view";
import { replyTemplates } from "@/domains/copilot/templates";
import type { CopilotDraft, SupportIntent } from "@/domains/copilot/provider";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
import { QueryError } from "@/components/empty-state";
import { api } from "@/lib/api-client";
import type { ChatMessage, Conversation } from "@/domains/messaging/provider";
export function SmartInbox({ configured }: { configured: boolean }) {
  const params = useSearchParams(),
    pathname = usePathname();
  const view = parseInboxView(params);
  const [activeId, setActiveId] = useState<string | null>(null),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [showTemplates, setShowTemplates] = useState(false),
    [feedback, setFeedback] = useState(""),
    [showAssistance, setShowAssistance] = useState(false),
    [candidate, setCandidate] = useState<{
      draft: CopilotDraft;
      conversationId: string | null;
    } | null>(null);
  function updateView(
    change: Partial<{
      search: string;
      filter: InboxFilter;
      status: InboxStatus;
    }>,
  ) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(change)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    window.history.replaceState(
      null,
      "",
      next.size ? `${pathname}?${next}` : pathname,
    );
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { id: string }; permissions: string[] }>("/api/me"),
    enabled: configured,
    retry: false,
  });
  const inbox = useQuery({
    queryKey: ["conversations"],
    queryFn: () =>
      api<{ items: Conversation[]; provider: string; reason?: string }>(
        "/api/messaging",
      ),
    enabled: configured,
    refetchInterval: 30000,
  });
  const active = inbox.data?.items.find((item) => item.id === activeId) ?? null;
  const reply = active ? (drafts[active.id] ?? "") : "";
  function setReply(value: string) {
    if (active) setDrafts((current) => ({ ...current, [active.id]: value }));
  }
  const history = useQuery({
    queryKey: ["messages", active?.id],
    queryFn: () =>
      api<{ messages: ChatMessage[] }>(
        `/api/messaging?id=${encodeURIComponent(active!.id)}`,
      ),
    enabled: Boolean(active) && configured,
    refetchInterval: 15000,
  });
  const connected = inbox.data?.provider === "official",
    isMock = inbox.data?.provider === "mock";
  const canCompose =
    Boolean(active) &&
    (connected || isMock) &&
    Boolean(me.data?.permissions.includes("conversations.reply"));
  const send = useMutation({
    mutationFn: (draft: {
      conversationId: string;
      text: string;
      mock: boolean;
    }) =>
      api("/api/messaging", {
        method: "POST",
        body: JSON.stringify({
          conversationId: draft.conversationId,
          text: draft.text,
        }),
      }),
    onSuccess: (_data, draft) => {
      setDrafts((current) =>
        current[draft.conversationId] === draft.text
          ? { ...current, [draft.conversationId]: "" }
          : current,
      );
      cache.invalidateQueries({ queryKey: ["messages", draft.conversationId] });
      setFeedback(
        draft.mock
          ? "Development message saved. Nothing was sent to Eldorado."
          : "Message sent through the authorized messaging provider.",
      );
    },
    onError: (error) => setFeedback(error.message),
  });
  const assistance = useMutation({
    mutationFn: (conversationId: string) =>
      api<{ draft: CopilotDraft }>("/api/copilot", {
        method: "POST",
        body: JSON.stringify({
          conversationId,
          mode: "template",
          task: "suggest_reply",
        }),
      }),
    onSuccess: (result, conversationId) =>
      setCandidate({ draft: result.draft, conversationId }),
  });
  function submitReply() {
    if (active && canCompose && reply.trim() && !send.isPending)
      send.mutate({
        conversationId: active.id,
        text: reply.trim(),
        mock: isMock,
      });
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        mayHandleInboxShortcut(event.target, input.current) &&
        canCompose &&
        active &&
        reply.trim() &&
        !send.isPending
      ) {
        event.preventDefault();
        send.mutate({
          conversationId: active.id,
          text: reply.trim(),
          mock: isMock,
        });
        return;
      }
      const target = event.target;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        target instanceof HTMLElement &&
        !target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [active, canCompose, isMock, reply, send]);
  const rows = filterConversations(
    inbox.data?.items ?? [],
    view,
    me.data?.profile.id,
  );
  const orderedMessages = chronologicalMessages(history.data?.messages ?? []);
  const orderContext = useQuery({
    queryKey: ["inbox-order", active?.orderId],
    queryFn: () =>
      api<{
        order: {
          id: string;
          buyer_username: string;
          product_title: string;
          amount: number;
          currency: string;
          quantity: number;
          state: string;
          delivery_method: string | null;
          purchased_at: string;
        };
      }>(`/api/orders/${encodeURIComponent(active!.orderId)}`),
    enabled:
      configured &&
      Boolean(active) &&
      !isMock &&
      /^[0-9a-f-]{36}$/i.test(active?.orderId ?? ""),
    retry: false,
  });
  function previewTemplate(intent: SupportIntent) {
    const template = replyTemplates.find((item) => item.id === intent)!;
    setCandidate({
      conversationId: active?.id ?? null,
      draft: {
        source: "template",
        text: template.text,
        intent,
        requiresHumanReview: true,
        escalate: template.escalate,
        reason: "A reusable English template. Review all facts before sending.",
      },
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="CUSTOMER EXPERIENCE"
        title="Smart inbox"
        description="Every conversation. Full context. One focused workspace."
      >
        <span className="pill pill-amber">
          <span className="status-dot amber" />
          {isMock
            ? "Development fixtures"
            : "Awaiting official messaging access"}
        </span>
        <Button variant="outline" asChild>
          <Link href="/settings">
            <SettingsIcon />
            Integration settings
          </Link>
        </Button>
      </PageHeading>
      <div className="inbox-toolbar">
        <div className="inbox-section-label">
          <MessageSquare size={15} />
          <strong>Customer conversations</strong>
          <span className="count-badge">{inbox.data?.items.length ?? 0}</span>
        </div>
        <span className="quiet-label">
          <ShieldCheck size={13} /> Authorized integrations only
        </span>
      </div>
      {inbox.isError && (
        <QueryError
          message={inbox.error.message}
          retry={() => inbox.refetch()}
        />
      )}
      <div className="inbox-grid">
        <aside className="conversation-list">
          <div className="list-heading">
            <h2>Inbox</h2>
            <button
              className="icon-button"
              aria-label="Show priority conversations"
              onClick={() =>
                updateView({
                  filter: view.filter === "priority" ? "all" : "priority",
                })
              }
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>
          <label className="input-search">
            <Search size={14} />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations..."
              ref={searchInput}
              value={view.search}
              onChange={(e) =>
                updateView({ search: e.target.value.slice(0, 100) })
              }
            />
            <kbd>/</kbd>
          </label>
          <div className="segmented">
            {(["all", "unread", "priority", "assigned"] as const).map(
              (value) => (
                <button
                  className={view.filter === value ? "selected" : ""}
                  key={value}
                  onClick={() => updateView({ filter: value })}
                >
                  {value === "all"
                    ? "All conversations"
                    : value === "assigned"
                      ? "Assigned to me"
                      : value[0].toUpperCase() + value.slice(1)}
                </button>
              ),
            )}
          </div>
          <label className="select-label" style={{ padding: "0 15px 12px" }}>
            Status
            <select
              aria-label="Filter conversation status"
              value={view.status}
              onChange={(event) =>
                updateView({ status: event.target.value as InboxStatus })
              }
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <div className="conversation-results">
            {inbox.isLoading ? (
              <div className="skeleton-lines" />
            ) : rows.length ? (
              rows.map((c) => (
                <button
                  className={`conversation-row ${active?.id === c.id ? "selected" : ""}`}
                  key={c.id}
                  onClick={() => {
                    setActiveId(c.id);
                    setCandidate(null);
                    setFeedback("");
                  }}
                >
                  <span className="avatar">
                    {c.buyer.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{c.buyer}</strong>
                    <p>{c.product}</p>
                    <small>
                      {c.orderId} ·{" "}
                      {c.priority === "high"
                        ? "High priority"
                        : c.status === "resolved"
                          ? "Resolved"
                          : "Open"}
                      {c.assignedTo === me.data?.profile.id
                        ? " · Assigned to you"
                        : ""}
                    </small>
                  </div>
                  {c.unread && <span className="unread-dot" />}
                </button>
              ))
            ) : (
              <div className="list-empty">
                <span className="list-empty-icon">
                  <MessageSquare size={22} />
                </span>
                <strong>
                  {view.search
                    ? "No matching conversations"
                    : "A quieter inbox starts here"}
                </strong>
                <p>
                  {view.search
                    ? "Try another buyer, order, or product."
                    : "Your buyer conversations will appear once an official messaging integration is connected."}
                </p>
                <span className="mini-status">
                  <span className="status-dot amber" />
                  NOT CONNECTED
                </span>
              </div>
            )}
          </div>
          <div className="inbox-bottom">
            <Keyboard size={13} />
            <span>Navigate faster</span>
            <kbd>⌘ K</kbd>
          </div>
        </aside>
        <section className="conversation-workspace">
          <div className="conversation-header">
            <span className="avatar small-avatar">
              <Headphones size={18} />
            </span>
            <div>
              <strong>{active?.buyer ?? "Your next great conversation"}</strong>
              <small>
                {active
                  ? active.orderId
                  : "Choose a conversation to get started"}
              </small>
            </div>
            <span className="chat-header-actions">
              <span className="pill pill-muted">
                {active
                  ? active.status === "resolved"
                    ? "Resolved"
                    : "Open"
                  : "No conversation selected"}
              </span>
            </span>
          </div>
          <div className="integration-notice">
            <LockKeyhole size={13} />
            <span>
              {isMock
                ? "Development fixtures only. No messages are exchanged with Eldorado."
                : "Live messaging is locked until Eldorado provides an authorized integration."}
            </span>
            <Link href="/settings">
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="message-history" aria-live="polite">
            {active ? (
              <>
                {history.isLoading && <div className="skeleton-lines" />}
                {history.isError && (
                  <QueryError message={history.error.message} />
                )}
                <div className="message-date">
                  {isMock ? "DEVELOPMENT CONVERSATION" : "CONVERSATION HISTORY"}
                </div>
                {orderedMessages.map((message) => (
                  <div
                    className={`message ${message.sender === "agent" ? "outgoing" : ""}`}
                    key={message.id}
                  >
                    <span className="message-author">
                      {message.sender === "buyer"
                        ? active.buyer
                        : "Support agent"}
                    </span>
                    <p>{message.text}</p>
                    <small>
                      {new Date(message.createdAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {message.delivery}
                      {message.sender === "agent" && <CheckCheck size={12} />}
                    </small>
                  </div>
                ))}
              </>
            ) : (
              <div className="workspace-empty">
                <div className="orbit-illustration">
                  <div className="orbit-ring ring-one" />
                  <div className="orbit-ring ring-two" />
                  <div className="orbit-core">
                    <MessageSquare size={32} />
                  </div>
                  <span className="orbit-spark spark-one">
                    <Zap size={13} />
                  </span>
                  <span className="orbit-spark spark-two">
                    <ShieldCheck size={13} />
                  </span>
                </div>
                <span className="eyebrow">LESS FRICTION. MORE CONNECTION.</span>
                <h2>Support, with a clearer view.</h2>
                <p>
                  Your conversations and order context belong together.
                  <br />
                  Connect authorized messaging to bring them here.
                </p>
                <Link href="/settings" className="empty-link">
                  View integration requirements <ArrowUpRight size={13} />
                </Link>
                <div className="workspace-empty-features">
                  <span>
                    <CheckCheck size={13} /> Shared context
                  </span>
                  <span>
                    <ShieldCheck size={13} /> Controlled access
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="composer">
            <div className="composer-mode">
              <strong>
                <MessageSquare size={12} /> Reply
              </strong>
              <span>
                <LockKeyhole size={11} />
                {isMock ? "Development only" : "Not connected"}
              </span>
            </div>
            <textarea
              ref={input}
              aria-label="Message reply"
              placeholder={
                canCompose
                  ? "Write a thoughtful reply..."
                  : "Connect authorized messaging to reply to buyers."
              }
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={!canCompose}
              maxLength={5000}
            />
            {showTemplates && (
              <div className="quick-replies">
                {replyTemplates.map((template) => (
                  <button
                    key={template.name}
                    onClick={() => {
                      setReply(template.text);
                      setShowTemplates(false);
                      input.current?.focus();
                    }}
                  >
                    {template.name}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            )}
            <div className="composer-tools">
              <div>
                <button
                  aria-label="Attachments unavailable"
                  title="Attachments require an authorized messaging provider"
                  disabled
                >
                  <Paperclip size={16} />
                </button>
                <button
                  aria-label="Quick replies"
                  onClick={() => setShowTemplates((value) => !value)}
                  disabled={!canCompose}
                >
                  <FileText size={16} />
                </button>
                <button
                  aria-label="Open reply assistance"
                  title="Local templates available; external AI is not configured"
                  onClick={() => setShowAssistance(true)}
                >
                  <Sparkles size={16} />
                </button>
              </div>
              <span>⌘ Enter to send</span>
              <Button
                size="sm"
                onClick={submitReply}
                disabled={!canCompose || !reply.trim() || send.isPending}
              >
                {send.isPending
                  ? "Sending..."
                  : isMock
                    ? "Send test"
                    : "Send reply"}
                <Send size={13} />
              </Button>
            </div>
            {feedback && (
              <p role="status" className="inline-feedback">
                {feedback}
              </p>
            )}
          </div>
        </section>
        <aside className="customer-context">
          <div className="context-title">
            <span>ORDER CONTEXT</span>
            <MoreHorizontal size={16} />
          </div>
          <div className="context-avatar">
            <ShoppingIcon />
          </div>
          <h3>{active ? "Linked order" : "The full picture."}</h3>
          <p className="context-description">
            {active
              ? "Open the authorized order record to view details."
              : "Everything you need to help your buyer, right where you need it."}
          </p>
          <div className="context-fields">
            {[
              ["Order ID", active?.orderId ?? "—"],
              [
                "Buyer",
                orderContext.data?.order.buyer_username ?? active?.buyer ?? "—",
              ],
              [
                "Product",
                orderContext.data?.order.product_title ??
                  active?.product ??
                  "—",
              ],
              [
                "Payment",
                orderContext.data
                  ? money(
                      Number(orderContext.data.order.amount),
                      orderContext.data.order.currency,
                    )
                  : "—",
              ],
              ["Delivery status", orderContext.data?.order.state ?? "—"],
              [
                "Quantity",
                orderContext.data
                  ? String(orderContext.data.order.quantity)
                  : "—",
              ],
              [
                "Delivery method",
                orderContext.data?.order.delivery_method ?? "—",
              ],
              ["Assigned agent", active?.assignedTo ?? "Unassigned"],
            ].map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {orderContext.isError && (
            <p className="form-error" role="status">
              Order context is unavailable or outside your assigned access.
            </p>
          )}
          {active && !isMock && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orders/${active.orderId}`}>
                Open order
                <ArrowUpRight size={13} />
              </Link>
            </Button>
          )}
          <div className="copilot-card">
            <div>
              <Sparkles size={16} />
              <span>RIVOX COPILOT</span>
              <span className="tiny-badge">AI OFF</span>
            </div>
            <h4>A second pair of eyes.</h4>
            <p>
              External AI is off. Explore English reply templates without
              sending buyer data to a provider.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAssistance(true)}
            >
              Explore reply templates
              <ArrowUpRight size={12} />
            </Button>
          </div>
        </aside>
      </div>
      <Dialog open={showAssistance} onOpenChange={setShowAssistance}>
        <DialogContent>
          <DialogTitle>Reply assistance</DialogTitle>
          <DialogDescription>
            External AI is not configured. These local English templates do not
            use AI or send data outside this workspace. Every response remains
            your decision.
          </DialogDescription>
          <div className="quick-replies">
            {replyTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => previewTemplate(template.id)}
              >
                {template.name}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={!canCompose || assistance.isPending}
            onClick={() => active && assistance.mutate(active.id)}
          >
            {assistance.isPending
              ? "Selecting template..."
              : "Suggest a local template"}
          </Button>
          {assistance.isError && (
            <p role="alert" className="form-error">
              {assistance.error.message}
            </p>
          )}
          {candidate && (
            <div className="internal-note">
              <span className="eyebrow">TEMPLATE · HUMAN REVIEW REQUIRED</span>
              <p>{candidate.draft.text}</p>
              {candidate.draft.escalate && (
                <p className="form-error">
                  Supervisor review recommended. No operation has been requested
                  or executed.
                </p>
              )}
              <p>{candidate.draft.reason}</p>
              <Button
                disabled={
                  !canCompose || candidate.conversationId !== active?.id
                }
                onClick={() => {
                  setReply(candidate.draft.text);
                  setShowAssistance(false);
                  setFeedback(
                    "Template inserted as a draft. Review it before sending.",
                  );
                  input.current?.focus();
                }}
              >
                Use as draft
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(candidate.draft.text);
                    setFeedback("Template copied. Nothing was sent.");
                  } catch {
                    setFeedback(
                      "Clipboard unavailable. Select the template text to copy it.",
                    );
                  }
                }}
              >
                Copy template
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function SettingsIcon() {
  return <SlidersHorizontal size={14} />;
}
function ShoppingIcon() {
  return <MessageSquare size={23} />;
}
