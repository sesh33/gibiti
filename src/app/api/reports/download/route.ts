import { requireStaff } from "@/domains/authentication/session";
import { eldoradoClient } from "@/domains/eldorado/client";
import { reportRequest } from "@/domains/eldorado/seller-contracts";
import { safeCsv } from "@/domains/reports/csv";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("reports.export", true);
    if (!staff.permissions.has("orders.read"))
      throw new AppError(
        "FORBIDDEN",
        "Account-wide reports require full order read permission.",
        403,
      );
    const input = reportRequest.parse(await readBody(request));
    const { data: allowed, error: rateError } = await staff.db.rpc(
      "consume_rate_limit",
      { bucket: "reports.download", max_hits: 3, window_seconds: 60 },
    );
    if (rateError || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before downloading another report.",
        429,
      );
    const report = await eldoradoClient().downloadReport(input);
    const bytes =
      report.type === "csv"
        ? Buffer.from(
            safeCsv(
              new TextDecoder("utf-8", { fatal: true }).decode(report.bytes),
            ),
          )
        : report.bytes;
    const { error } = await staff.db.rpc("record_report_export", {
      report_kind: input.kind,
      from_day: input.from,
      until_day: input.until,
      byte_count: report.bytes.byteLength,
    });
    if (error)
      throw new AppError(
        "EXPORT_AUDIT_FAILED",
        "Your access or audit could not be confirmed. The report was not released.",
        503,
      );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          report.type === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="eldorado-${input.kind}-${input.from}-${input.until}.${report.type}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
