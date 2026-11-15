import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { buildImportPreview } from "@/domains/offers/import";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.create", true);
    const { data, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "offers.batch_preview",
      max_hits: 10,
      window_seconds: 60,
    });
    if (error || !data)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before preparing another import preview.",
        429,
      );
    return NextResponse.json(
      await buildImportPreview(await readBody(request), staff),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
