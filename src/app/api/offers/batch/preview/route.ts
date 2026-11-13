import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { buildBatchPreview } from "@/domains/offers/batch";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.read");
    const { data, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "offers.batch_preview",
      max_hits: 10,
      window_seconds: 60,
    });
    if (error || !data)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before preparing another preview.",
        429,
      );
    return NextResponse.json(
      await buildBatchPreview(await readBody(request), staff),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
