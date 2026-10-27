"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
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
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
import { QueryError } from "@/components/empty-state";
import { api } from "@/lib/api-client";
import type { ChatMessage, Conversation } from "@/domains/messaging/provider";
const templates = [
  {
    name: "Welcome",
    text: "Hi! Thanks for reaching out. How can I help you with your order today?",
  },
  {
    name: "Checking your order",
    text: "Thanks for your patience. I'm reviewing your order details and will update you when I have confirmed information.",
  },
  {
    name: "Need more details",
    text: "Could you share a few more details so I can assist you accurately? Please do not send passwords or payment information.",
  },
];
export function SmartInbox({ configured }: { configured: boolean }) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [active, setActive] = useState<Conversation | null>(null),
    [reply, setReply] = useState(""),
    [showTemplates, setShowTemplates] = useState(false),
    [feedback, setFeedback] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const cache = useQueryClient();
  const inbox = useQuery({
    queryKey: ["conversations"],
    queryFn: () =>
      api<{ items: Conversation[]; provider: string; reason?: string }>(
        "/api/messaging",
      ),
    enabled: configured,
    refetchInterval: 30000,
  });
  const history = useQuery({
    queryKey: ["messages", active?.id],
    queryFn: () =>
      api<{ messages: ChatMessage[] }>(
        `/api/messaging?id=${encodeURIComponent(active!.id)}`,
      ),
    enabled: Boolean(active) && configured,
    refetchInterval: 15000,
  });
  const send = useMutation({
    mutationFn: () =>
      api("/api/messaging", {
        method: "POST",
        body: JSON.stringify({ conversationId: active?.id, text: reply }),
      }),
    onSuccess: () => {
      setReply("");
      cache.invalidateQueries({ queryKey: ["messages", active?.id] });
      setFeedback("Development message saved. Nothing was sent to Eldorado.");
    },
    onError: (error) => setFeedback(error.message),
  });
  const connected = inbox.data?.provider === "official",
    isMock = inbox.data?.provider === "mock",
    canCompose = Boolean(active) && (connected || isMock);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        canCompose &&
        reply.trim() &&
        !send.isPending
      ) {
        event.preventDefault();
        send.mutate();
      }
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [canCompose, reply, send]);
  const rows = (inbox.data?.items ?? []).filter(
    (c) =>
      (filter === "all" ||
        (filter === "unread" && c.unread) ||
        (filter === "priority" && c.priority === "high")) &&
      `${c.buyer} ${c.orderId} ${c.product}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
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
                setFilter(filter === "priority" ? "all" : "priority")
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="segmented">
            {["all", "unread", "priority"].map((value) => (
              <button
                className={filter === value ? "selected" : ""}
                key={value}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "All conversations"
                  : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div className="conversation-results">
            {inbox.isLoading ? (
              <div className="skeleton-lines" />
            ) : rows.length ? (
              rows.map((c) => (
                <button
                  className={`conversation-row ${active?.id === c.id ? "selected" : ""}`}
                  key={c.id}
                  onClick={() => {
                    setActive(c);
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
                      {c.priority === "high" ? "High priority" : "Open"}
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
                  {search
                    ? "No matching conversations"
                    : "A quieter inbox starts here"}
                </strong>
                <p>
                  {search
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
                {active ? "Open" : "No conversation selected"}
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
                {history.data?.messages.map((message) => (
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
                {templates.map((template) => (
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
                  aria-label="AI Copilot not configured"
                  title="AI Copilot requires configuration and privacy review"
                  disabled
                >
                  <Sparkles size={16} />
                </button>
              </div>
              <span>⌘ Enter to send</span>
              <Button
                size="sm"
                onClick={() => send.mutate()}
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
              ["Buyer", active?.buyer ?? "—"],
              ["Product", active?.product ?? "—"],
              ["Payment", "—"],
              ["Delivery status", "—"],
              ["Assigned agent", active?.assignedTo ?? "Unassigned"],
            ].map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
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
              <span className="tiny-badge">OFF</span>
            </div>
            <h4>A second pair of eyes.</h4>
            <p>Context-aware assistance, with a human always in control.</p>
            <Link href="/settings">
              View requirements <ArrowUpRight size={12} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
function SettingsIcon() {
  return <SlidersHorizontal size={14} />;
}
function ShoppingIcon() {
  return <MessageSquare size={23} />;
}
