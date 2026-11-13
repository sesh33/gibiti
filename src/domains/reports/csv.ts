import { AppError } from "@/lib/errors";
/** Re-encode verified CSV while neutralizing spreadsheet formulas in text cells. */
export function safeCsv(input: string) {
  const source = input.replace(/^\uFEFF/, "");
  let delimiter = ",",
    quoted = false,
    commas = 0,
    semicolons = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === "\n" || char === "\r") break;
      if (char === ",") commas++;
      if (char === ";") semicolons++;
    }
  }
  if (semicolons > commas) delimiter = ";";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    inQuotes = false,
    closed = false;
  const pushCell = () => {
    if (cell.length > 1048576)
      throw new AppError(
        "REPORT_CELL_TOO_LARGE",
        "Use a shorter report period.",
        413,
      );
    row.push(cell);
    cell = "";
    closed = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else cell += char;
      continue;
    }
    if (char === '"' && !cell && !closed) {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\r" || char === "\n") {
      pushCell();
      rows.push(row);
      row = [];
      if (char === "\r" && source[i + 1] === "\n") i++;
      continue;
    }
    if (closed)
      throw new AppError(
        "INVALID_REPORT_CSV",
        "The official report contains malformed CSV.",
        502,
      );
    cell += char;
  }
  if (inQuotes)
    throw new AppError(
      "INVALID_REPORT_CSV",
      "The official report contains an incomplete CSV field.",
      502,
    );
  if (cell || row.length || closed) {
    pushCell();
    rows.push(row);
  }
  return (
    "\uFEFF" +
    rows
      .map((fields) =>
        fields
          .map((value) => {
            const trimmed = value.trimStart();
            const numeric = /^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed);
            const safe =
              /^[=+\-@\t\r\n]/.test(value) || /^[=+\-@]/.test(trimmed)
                ? numeric
                  ? value
                  : "'" + value
                : value;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(delimiter),
      )
      .join("\r\n") +
    "\r\n"
  );
}
