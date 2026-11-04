import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
import { readBody, requireSameOrigin } from "@/lib/http";
import {
  availabilityDependencies,
  availabilityInputSchema,
  availabilityOperationSchema,
  executeOfferAvailability,
} from "@/domains/offers/availability";

export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const staff = await requireStaff("offers.read");
    const query = z
      .object({ idempotencyKey: z.uuid().optional() })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    let select = staff.db.from("offer_availability_operations").select("*");
    if (query.idempotencyKey) {
      const { data, error } = await select
        .eq("actor_id", staff.user.id)
        .eq("idempotency_key", query.idempotencyKey)
        .maybeSingle();
      if (error)
        throw new AppError(
          "AVAILABILITY_QUERY_FAILED",
          "This operation could not be loaded.",
          500,
        );
      return NextResponse.json(
        { operation: data ? availabilityOperationSchema.parse(data) : null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!staff.permissions.has("audit.read"))
      select = select.eq("actor_id", staff.user.id);
    const { data, error } = await select
      .order("created_at", { ascending: false })
      .limit(30);
    if (error)
      throw new AppError(
        "AVAILABILITY_QUERY_FAILED",
        "Listing operations could not be loaded.",
        500,
      );
    return NextResponse.json(
      { items: z.array(availabilityOperationSchema).parse(data ?? []) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.pause");
    if (!staff.permissions.has("offers.read"))
      throw new AppError(
        "FORBIDDEN",
        "Listing read access is also required.",
        403,
      );
    const input = availabilityInputSchema.parse(await readBody(request));
    const result = await executeOfferAvailability(
      input,
      availabilityDependencies(staff),
    );
    return NextResponse.json(result, {
      status:
        result.operation.status === "unknown" ||
        result.operation.status === "running"
          ? 202
          : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
