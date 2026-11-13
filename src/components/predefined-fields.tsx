"use client";
import { currencies, deliveryTimes } from "@/domains/eldorado/contracts";
const categories = [
  "Account",
  "CustomItem",
  "Currency",
  "Boosting",
  "RequestedBoosting",
  "ManagedBoosting",
  "TopUp",
  "GiftCard",
];
const methods = [
  "Unspecified",
  "EpicGifting",
  "IslandDelivery",
  "GamePass",
  "MailTrade",
  "AuctionHouse",
  "InGameTrade",
  "RedeemCode",
  "AutoClaim",
  "LoginMethod",
  "Donation",
];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function PredefinedFields({
  document,
  onChange,
  disabled,
}: {
  document: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  let model: unknown;
  try {
    model = JSON.parse(document);
  } catch {
    return (
      <p role="alert">Fix the advanced offer document to edit its fields.</p>
    );
  }
  if (
    !record(model) ||
    !record(model.details) ||
    !record(model.details.pricing) ||
    !record(model.augmentedGame)
  )
    return (
      <p role="alert">
        The advanced document needs details, pricing and game information.
      </p>
    );
  const data = model;
  function read(path: string[]) {
    let value: unknown = data;
    for (const part of path) value = record(value) ? value[part] : undefined;
    return typeof value === "string" || typeof value === "number" ? value : "";
  }
  function write(path: string[], value: unknown) {
    const next = structuredClone(data);
    let node: Record<string, unknown> = next;
    for (const part of path.slice(0, -1)) {
      if (!record(node[part])) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[path.at(-1)!] = value;
    onChange(JSON.stringify(next, null, 2));
  }
  const field = (label: string, path: string[], numeric = false) => (
    <label className="field-label" key={label}>
      {label}
      <input
        required
        type={numeric ? "number" : "text"}
        step={numeric ? "any" : undefined}
        value={read(path)}
        disabled={disabled}
        onChange={(event) =>
          write(path, numeric ? event.target.valueAsNumber : event.target.value)
        }
      />
    </label>
  );
  const select = (label: string, path: string[], values: readonly string[]) => (
    <label className="field-label" key={label}>
      {label}
      <select
        aria-label={label}
        value={read(path)}
        disabled={disabled}
        onChange={(event) => write(path, event.target.value)}
      >
        {values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="reply-fields">
      {field("Verified game ID", ["augmentedGame", "gameId"])}
      {select("Product category", ["augmentedGame", "category"], categories)}
      <label className="field-label">
        Public description
        <textarea
          rows={4}
          value={read(["details", "description"])}
          disabled={disabled}
          onChange={(event) =>
            write(["details", "description"], event.target.value)
          }
        />
      </label>
      {field(
        "Offer unit price",
        ["details", "pricing", "pricePerUnit", "amount"],
        true,
      )}
      {select(
        "Offer currency",
        ["details", "pricing", "pricePerUnit", "currency"],
        currencies,
      )}
      {field("Offer stock", ["details", "pricing", "quantity"], true)}
      {field("Minimum purchase", ["details", "pricing", "minQuantity"], true)}
      {select(
        "Guaranteed delivery time",
        ["details", "guaranteedDeliveryTime"],
        deliveryTimes,
      )}
      {select("Delivery method", ["details", "deliveryMethod"], methods)}
      <label className="field-label">
        Trade environment ID (optional)
        <input
          value={read(["augmentedGame", "tradeEnvironmentId"])}
          disabled={disabled}
          onChange={(event) =>
            write(
              ["augmentedGame", "tradeEnvironmentId"],
              event.target.value.trim() || null,
            )
          }
        />
      </label>
      <p className="scope-note">
        Use game and environment IDs confirmed in your catalog. Preserve
        existing attributes and volume discounts in the advanced document.
        Public descriptions must not contain account credentials.
      </p>
    </div>
  );
}
