import "server-only";
import { z } from "zod";
import { predefinedInput } from "@/domains/eldorado/contracts";
import { AppError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { requireStaff } from "@/domains/authentication/session";

export const importColumns = [
  "gameId",
  "category",
  "tradeEnvironmentId",
  "description",
  "guaranteedDeliveryTime",
  "quantity",
  "minQuantity",
  "amount",
  "currency",
  "deliveryMethod",
] as const;
const requiredColumns = importColumns.filter(
  (name) => name !== "tradeEnvironmentId",
);
const inputSchema = z
  .object({
    format: z.enum(["csv", "json"]),
    text: z.string().min(1).max(48000),
  })
  .strict();
export type ImportProblem = { row: number; field: string; message: string };
export type ImportItem = {
  row: number;
  document: z.infer<typeof predefinedInput>;
};

// A small bounded RFC 4180 parser. Record line numbers survive quoted newlines.
// No cell is evaluated, downloaded, or forwarded to the marketplace as CSV.
function csvRecords(text: string) {
  const records: { row: number; cells: string[] }[] = [];
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  let line = 1,
    start = 1;
  function record() {
    cells.push(cell);
    if (cells.length > 1 || cells.some((value) => value.length))
      records.push({ row: start, cells });
    cells = [];
    cell = "";
    closed = false;
    start = line + 1;
  }
  for (let i = 0; i < normalized.length; i++) {
    const character = normalized[i];
    if (quoted) {
      if (character === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += character;
        if (character === "\n") line++;
      }
      continue;
    }
    if (character === '"' && !cell && !closed) {
      quoted = true;
      continue;
    }
    if (character === ",") {
      cells.push(cell);
      cell = "";
      closed = false;
      continue;
    }
    if (character === "\n") {
      record();
      line++;
      continue;
    }
    if (closed || character === '"')
      return {
        records: [],
        problem: {
          row: line,
          field: "CSV",
          message: "Unexpected text or quote outside a quoted cell.",
        },
      };
    cell += character;
  }
  if (quoted)
    return {
      records: [],
      problem: {
        row: start,
        field: "CSV",
        message: "A quoted cell is not closed.",
      },
    };
  record();
  return { records, problem: null };
}

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())
  )
    return Number.NaN;
  return Number(value.trim());
}

export function parseOfferImport(raw: unknown): {
  valid: boolean;
  items: ImportItem[];
  problems: ImportProblem[];
} {
  const input = inputSchema.parse(raw);
  if (Buffer.byteLength(input.text, "utf8") > 48000)
    throw new AppError(
      "IMPORT_TOO_LARGE",
      "Use a file smaller than 48 KB.",
      413,
    );
  const problems: ImportProblem[] = [];
  let rows: { row: number; value: unknown }[];
  if (input.format === "csv") {
    const parsed = csvRecords(input.text);
    if (parsed.problem)
      return { valid: false, items: [], problems: [parsed.problem] };
    const [header, ...values] = parsed.records;
    if (!header)
      return {
        valid: false,
        items: [],
        problems: [
          {
            row: 1,
            field: "CSV",
            message: "A header and at least one product row are required.",
          },
        ],
      };
    const names = header.cells.map((name) => name.trim());
    if (
      new Set(names).size !== names.length ||
      names.some(
        (name) =>
          !importColumns.includes(name as (typeof importColumns)[number]),
      ) ||
      requiredColumns.some((name) => !names.includes(name))
    )
      return {
        valid: false,
        items: [],
        problems: [
          {
            row: header.row,
            field: "header",
            message:
              "Use the template headers exactly, without duplicate or unknown columns.",
          },
        ],
      };
    rows = values.map(({ row, cells }) => ({
      row,
      value:
        cells.length === names.length
          ? Object.fromEntries(names.map((name, index) => [name, cells[index]]))
          : null,
    }));
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text.replace(/^\uFEFF/, ""));
    } catch {
      return {
        valid: false,
        items: [],
        problems: [
          {
            row: 1,
            field: "JSON",
            message: "The JSON file is not valid JSON.",
          },
        ],
      };
    }
    if (!Array.isArray(parsed))
      return {
        valid: false,
        items: [],
        problems: [
          {
            row: 1,
            field: "JSON",
            message:
              "Use an array of flat product objects with the template fields.",
          },
        ],
      };
    rows = parsed.map((value, index) => ({ row: index + 1, value }));
  }
  if (rows.length < 1 || rows.length > 10)
    return {
      valid: false,
      items: [],
      problems: [
        {
          row: 1,
          field: "file",
          message: "Import between 1 and 10 products per preview.",
        },
      ],
    };
  const items: ImportItem[] = [],
    seen = new Map<string, number>();
  for (const entry of rows) {
    const value = entry.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push({
        row: entry.row,
        field: "row",
        message:
          "Each row must have exactly the template fields and cell count.",
      });
      continue;
    }
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (name) =>
          !importColumns.includes(name as (typeof importColumns)[number]),
      ) ||
      requiredColumns.some((name) => !(name in record))
    ) {
      problems.push({
        row: entry.row,
        field: "fields",
        message:
          "Missing or unknown fields. Secret, gift-card and arbitrary attribute imports are not accepted.",
      });
      continue;
    }
    const document = predefinedInput.safeParse({
      details: {
        description: record.description,
        guaranteedDeliveryTime: record.guaranteedDeliveryTime,
        pricing: {
          quantity: numeric(record.quantity),
          minQuantity: numeric(record.minQuantity),
          volumeDiscounts: [],
          pricePerUnit: {
            amount: numeric(record.amount),
            currency: record.currency,
          },
        },
        deliveryMethod: record.deliveryMethod,
      },
      augmentedGame: {
        gameId: record.gameId,
        category: record.category,
        tradeEnvironmentId:
          record.tradeEnvironmentId === "" ||
          record.tradeEnvironmentId === undefined
            ? null
            : record.tradeEnvironmentId,
        offerAttributes: [],
      },
      giftCardDetails: null,
    });
    if (!document.success) {
      for (const issue of document.error.issues)
        problems.push({
          row: entry.row,
          field: issue.path.join("."),
          message: issue.message,
        });
      continue;
    }
    if (
      !document.data.augmentedGame.gameId.trim() ||
      (document.data.augmentedGame.tradeEnvironmentId !== null &&
        !document.data.augmentedGame.tradeEnvironmentId.trim())
    ) {
      problems.push({
        row: entry.row,
        field: "gameId / tradeEnvironmentId",
        message: "Use verified IDs; whitespace is not an ID.",
      });
      continue;
    }
    const signature = JSON.stringify(document.data),
      duplicate = seen.get(signature);
    if (duplicate !== undefined) {
      problems.push({
        row: entry.row,
        field: "row",
        message: `This product duplicates row ${duplicate}.`,
      });
      continue;
    }
    seen.set(signature, entry.row);
    items.push({ row: entry.row, document: document.data });
  }
  return {
    valid: problems.length === 0,
    items: problems.length ? [] : items,
    problems,
  };
}

type Staff = Awaited<ReturnType<typeof requireStaff>>;
export async function buildImportPreview(raw: unknown, staff: Staff) {
  if (
    !staff.permissions.has("offers.read") ||
    !staff.permissions.has("offers.create")
  )
    throw new AppError(
      "FORBIDDEN",
      "Listing read and creation permissions are required.",
      403,
    );
  const result = parseOfferImport(raw);
  if (!result.valid) return result;
  const { data, error } = await supabaseAdmin()
    .from("offer_import_previews")
    .insert({ created_by: staff.user.id, items: result.items })
    .select("id,expires_at")
    .single();
  if (error || !data)
    throw new AppError(
      "IMPORT_PREVIEW_NOT_SAVED",
      "No marketplace change was sent. The preview could not be saved; confirm the import migration is applied.",
      503,
    );
  return { ...result, id: data.id, expiresAt: data.expires_at };
}
