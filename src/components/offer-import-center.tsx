"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileDown, FileUp, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommerceWorkflow } from "@/components/commerce-workflow";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import type { ImportItem, ImportProblem } from "@/domains/offers/import";

const template =
  'gameId,category,tradeEnvironmentId,description,guaranteedDeliveryTime,quantity,minQuantity,amount,currency,deliveryMethod\r\nVERIFIED_GAME_ID,TopUp,,"Public product description",Minute20,10,1,1.09,USD,InGameTrade\r\n';
type Preview = {
  valid: boolean;
  id?: string;
  expiresAt?: string;
  items: ImportItem[];
  problems: ImportProblem[];
};
type Attempt = { key: string; reason: string; id?: string; message: string };

export function OfferImportCenter({ configured }: { configured: boolean }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const permitted = ["offers.read", "offers.create"].every((permission) =>
    me.data?.permissions.includes(permission),
  );
  const [format, setFormat] = useState<"csv" | "json">("csv"),
    [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [attempts, setAttempts] = useState<Record<number, Attempt>>({});
  const pending = useRef(false);
  function reset() {
    setPreview(null);
    setAttempts({});
    setConfirmed(false);
    setMessage("");
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([template], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rivox-predefined-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function file(file?: File) {
    if (!file) return;
    reset();
    if (file.size > 48000) {
      setText("");
      setMessage("Use a UTF-8 CSV or JSON file smaller than 48 KB.");
      return;
    }
    try {
      setFormat(file.name.toLowerCase().endsWith(".json") ? "json" : "csv");
      setText(await file.text());
    } catch {
      setText("");
      setMessage("The file could not be read. Try a UTF-8 text file.");
    }
  }
  async function simulate(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    reset();
    try {
      setPreview(
        await api<Preview>("/api/offers/import/preview", {
          method: "POST",
          body: JSON.stringify({ format, text }),
        }),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The import preview could not be prepared.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function request(index: number) {
    if (!preview?.id || pending.current || !confirmed) return;
    pending.current = true;
    setBusy(true);
    const attempt = attempts[index] ?? {
      key: crypto.randomUUID(),
      reason: reason.trim(),
      message: "",
    };
    setAttempts((prior) => ({ ...prior, [index]: attempt }));
    try {
      const result = await api<{ id: string; message: string }>(
        `/api/offers/import/${preview.id}/request`,
        {
          method: "POST",
          body: JSON.stringify({
            rowIndex: index,
            reason: attempt.reason,
            idempotencyKey: attempt.key,
            confirm: true,
          }),
        },
      );
      setAttempts((prior) => ({
        ...prior,
        [index]: { ...attempt, id: result.id, message: result.message },
      }));
    } catch (error) {
      setAttempts((prior) => ({
        ...prior,
        [index]: {
          ...attempt,
          message:
            error instanceof Error
              ? error.message
              : "The outcome could not be verified. Recover with the same request key before starting another creation.",
        },
      }));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="commerce-page commerce-import">
      <PageHeading
        eyebrow="VALIDATED CATALOG IMPORT"
        title="Prepare products. Review every creation."
        description="Import up to 10 predefined products, inspect their exact contracts and request each creation through the existing approval workflow."
      >
        <Button variant="outline" onClick={download}>
          <FileDown size={14} /> Download CSV template
        </Button>
        <Button variant="outline" asChild>
          <Link href="/offers">Back to catalog</Link>
        </Button>
      </PageHeading>
      <CommerceWorkflow
        steps={[
          {
            title: "Add your products",
            description: "CSV or JSON with the supplied fields",
          },
          {
            title: "Validate the preview",
            description: "Resolve every issue before requesting",
          },
          {
            title: "Review each creation",
            description: "Independent approval, one row at a time",
          },
        ]}
      />
      <div className="info-banner">
        <ShieldCheck size={16} />
        <span>
          Previewing and requesting approval never send a marketplace write. One
          creation may be pending at a time. Resolve it in Approvals before
          requesting another row; expired, unsubmitted rows need a fresh
          preview.
        </span>
      </div>
      <div className="batch-layout">
        <section className="data-panel settings-section">
          <h2>
            <FileUp size={18} /> Import public product data
          </h2>
          <p className="scope-note">
            Use verified game and trade-environment IDs. Region, platform and
            denomination must already match that environment. This importer does
            not certify IDs, infer attributes from titles, upload gift-card
            codes or call an undocumented bulk API. Attribute-rich products
            belong in the individual editor.
          </p>
          <form className="catalog-editor-form" onSubmit={simulate}>
            <label className="field-label">
              UTF-8 CSV or JSON file
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                disabled={busy}
                onChange={(event) => {
                  void file(event.target.files?.[0]);
                }}
              />
            </label>
            <label className="field-label">
              Format
              <select
                value={format}
                disabled={busy}
                onChange={(event) => {
                  reset();
                  setFormat(event.target.value as "csv" | "json");
                }}
              >
                <option value="csv">CSV with template headers</option>
                <option value="json">JSON array with template fields</option>
              </select>
            </label>
            <label className="field-label">
              Public product data
              <textarea
                rows={12}
                required
                maxLength={48000}
                value={text}
                disabled={busy}
                placeholder="Paste CSV with the template header, or a JSON array of flat objects using the same field names."
                onChange={(event) => {
                  reset();
                  setText(event.target.value);
                }}
              />
            </label>
            <p className="scope-note">
              Numbers use a decimal point. Empty tradeEnvironmentId becomes
              null. Discounts and attributes remain empty; giftCardDetails is
              null. Unknown columns and duplicate products are rejected. A valid
              preview expires after five minutes.
            </p>
            <Button
              type="submit"
              disabled={!configured || !permitted || busy || !text}
            >
              {busy ? "Checking import…" : "Validate and preview"}
            </Button>
          </form>
          {!permitted && configured && (
            <p className="scope-note">
              Listing read and creation permissions, plus MFA, are required.
            </p>
          )}
          {message && (
            <p className="inline-feedback" role="status">
              {message}
            </p>
          )}
        </section>
        <section className="data-panel settings-section">
          <h2>Review before approval</h2>
          {!preview && (
            <p className="scope-note">
              The preview shows the exact price, stock, delivery and product IDs
              that would be submitted for each new offer.
            </p>
          )}
          {preview && !preview.valid && (
            <>
              <p className="inline-feedback" role="alert">
                Fix every error and validate again. No preview or approval
                request was saved.
              </p>
              <ul className="batch-selection">
                {preview.problems.map((problem, index) => (
                  <li key={index}>
                    <strong>
                      Row {problem.row} · {problem.field}
                    </strong>
                    <br />
                    {problem.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview?.valid && (
            <>
              <p className="scope-note">
                Validated {preview.items.length} product
                {preview.items.length === 1 ? "" : "s"}. Preview expires{" "}
                {preview.expiresAt
                  ? new Date(preview.expiresAt).toLocaleTimeString("en-US")
                  : "soon"}
                .
              </p>
              <label className="field-label">
                Reason for creating these products
                <textarea
                  rows={3}
                  minLength={10}
                  maxLength={2000}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="batch-listing">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  I checked each product&apos;s game, environment, pricing,
                  stock and delivery. I understand that each request needs
                  independent review.
                </span>
              </label>
              <div className="batch-list">
                {preview.items.map((item, index) => {
                  const document = item.document,
                    attempt = attempts[index],
                    pricing = document.details.pricing;
                  return (
                    <article
                      className="settings-section"
                      key={`${preview.id}:${index}`}
                    >
                      <h3>
                        Row {item.row} · {document.augmentedGame.category}
                      </h3>
                      <p className="scope-note">
                        Game <code>{document.augmentedGame.gameId}</code>
                        <br />
                        Environment{" "}
                        <code>
                          {document.augmentedGame.tradeEnvironmentId ??
                            "None supplied"}
                        </code>
                        <br />
                        {unitPrice(
                          pricing.pricePerUnit.amount,
                          pricing.pricePerUnit.currency,
                        )}{" "}
                        per unit · Stock {pricing.quantity} · Minimum{" "}
                        {pricing.minQuantity}
                        <br />
                        {document.details.guaranteedDeliveryTime} ·{" "}
                        {document.details.deliveryMethod}
                      </p>
                      {pricing.quantity < pricing.minQuantity && (
                        <p className="inline-feedback">
                          Stock is below the minimum purchase quantity; this
                          product cannot currently fulfill its minimum order.
                        </p>
                      )}
                      <details>
                        <summary>Inspect exact creation document</summary>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {JSON.stringify(document, null, 2)}
                        </pre>
                      </details>
                      {attempt?.message && (
                        <p className="inline-feedback" role="status">
                          {attempt.message}
                        </p>
                      )}
                      {attempt?.id ? (
                        <Link className="empty-link" href="/approvals">
                          Review saved request in Approvals →
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={
                            busy ||
                            !permitted ||
                            !confirmed ||
                            (!attempt && reason.trim().length < 10)
                          }
                          onClick={() => {
                            void request(index);
                          }}
                        >
                          {attempt
                            ? "Recover / retry same request"
                            : "Request this creation"}
                        </Button>
                      )}
                      {attempt && (
                        <small className="mono">
                          Request key: {attempt.key}
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
