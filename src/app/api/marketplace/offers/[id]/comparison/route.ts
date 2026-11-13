import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { comparePredefinedOffers } from "@/domains/offers/comparison";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const staff = await requireStaff("offers.read"),
      id = z.guid().parse((await params).id);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .parse(new URL(request.url).searchParams.get("page") ?? 1);
    const { data } = await staff.db
      .from("offers")
      .select("id")
      .eq("id", "predefined:" + id)
      .single();
    if (!data)
      throw new AppError(
        "NOT_FOUND",
        "Synchronize the own listing before comparing it.",
        404,
      );
    const { data: allowed, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "marketplace.comparison",
      max_hits: 10,
      window_seconds: 60,
    });
    if (error || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before comparing another page.",
        429,
      );
    return NextResponse.json(await comparePredefinedOffers(id, page), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
