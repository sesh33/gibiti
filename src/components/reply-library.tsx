"use client";
import { useState } from "react";
import { Check, Copy, MessageSquareText, Search } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { teamReplies, type TeamReply } from "@/domains/copilot/reply-library";

function ReplyEditor({ reply }: { reply: TeamReply }) {
  const [values, setValues] = useState<Record<string, string>>({}),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const fields = [
    ...new Set(
      [...reply.body.matchAll(/\[([a-z]+)\]/g)].map((match) => match[1]),
    ),
  ];
  const ready = fields.every((field) => values[field]?.trim());
  const text = reply.body.replace(
    /\[([a-z]+)\]/g,
    (original, field: string) => values[field]?.trim() || original,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError("");
    } catch {
      setError(
        "Clipboard unavailable. Select and copy the prepared reply below.",
      );
    }
  }
  return (
    <section
      className="data-panel settings-section reply-editor"
      aria-label="Prepare reply"
    >
      <div className="settings-heading">
        <span className="settings-icon">
          <MessageSquareText size={21} />
        </span>
        <div>
          <h2>{reply.title}</h2>
          <p>
            {reply.language === "EN" ? "English" : "French"} · {reply.category}
          </p>
        </div>
      </div>
      {reply.note && <p className="info-banner">{reply.note}</p>}
      {fields.length > 0 && (
        <div className="reply-fields">
          {fields.map((field) => (
            <label className="field-label" key={field}>
              {field === "amount"
                ? "Coin amount (include M or B)"
                : field === "username"
                  ? "Minecraft username"
                  : field === "price"
                    ? "Agreed pass price (Robux)"
                    : "Confirmed issue"}
              <input
                required
                maxLength={200}
                value={values[field] ?? ""}
                onChange={(event) => {
                  setValues((previous) => ({
                    ...previous,
                    [field]: event.target.value,
                  }));
                  setCopied(false);
                }}
              />
            </label>
          ))}
        </div>
      )}
      <label className="field-label">
        Prepared reply
        <textarea aria-label="Prepared reply" readOnly rows={8} value={text} />
      </label>
      <p className="scope-note">
        {ready
          ? "Check the order details, copy this reply and send it through your authorized customer channel."
          : "Fill in every order detail before copying."}
      </p>
      <Button disabled={!ready} onClick={copy}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Copied" : "Copy reply"}
      </Button>
      {copied && (
        <p role="status" className="scope-note">
          Reply copied. No message was sent.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ReplyLibrary() {
  const [search, setSearch] = useState(""),
    [language, setLanguage] = useState("all"),
    [selectedId, setSelectedId] = useState(teamReplies[0].id);
  const filtered = teamReplies.filter(
    (reply) =>
      (language === "all" || reply.language === language) &&
      `${reply.title} ${reply.body} ${reply.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected =
    filtered.find((reply) => reply.id === selectedId) ?? filtered[0];
  return (
    <>
      <PageHeading
        eyebrow="TEAM PLAYBOOK"
        title="Better replies. Ready to copy."
        description="Consistent customer support in English and French, with order details you verify before sending."
      />
      <div className="info-banner">
        <MessageSquareText size={17} />
        <span>
          Replies are copied for manual use. The Eldorado Seller API does not
          support sending chat messages.
        </span>
      </div>
      <div className="reply-toolbar">
        <label className="input-search">
          <Search size={16} />
          <input
            aria-label="Search reply templates"
            placeholder="Search Donut SMP, Robux, refunds…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="field-label">
          Language
          <select
            aria-label="Language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="all">All languages</option>
            <option value="EN">English</option>
            <option value="FR">French</option>
          </select>
        </label>
      </div>
      <div className="reply-layout">
        <section className="reply-list" aria-label="Reply templates">
          {filtered.map((reply) => (
            <button
              key={reply.id}
              className={`data-panel reply-option ${selected?.id === reply.id ? "selected" : ""}`}
              aria-pressed={selected?.id === reply.id}
              onClick={() => setSelectedId(reply.id)}
            >
              <span className="eyebrow">
                {reply.category} · {reply.language}
              </span>
              <strong>{reply.title}</strong>
              <span>{reply.body.slice(0, 110)}…</span>
            </button>
          ))}
          {!filtered.length && (
            <p role="status">No matching replies. Try another search.</p>
          )}
        </section>
        {selected && <ReplyEditor key={selected.id} reply={selected} />}
      </div>
    </>
  );
}
