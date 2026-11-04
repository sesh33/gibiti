import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
import { readBody, requireSameOrigin } from "@/lib/http";
import {
  availabilityDependencies,
  availabilityOperationSchema,
  reconcileOfferAvailability,
} from "@/domains/offers/availability";

export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.pause");
    if (!staff.permissions.has("offers.read"))
      throw new AppError(
        "FORBIDDEN",
        "Listing read access is also required.",
        403,
      );
    z.object({})
      .strict()
      .parse(await readBody(request));
    const id = z.uuid().parse((await params).id);
    const { data, error } = await staff.db
      .from("offer_availability_operations")
      .select("*")
      .eq("id", id)
      .eq("actor_id", staff.user.id)
      .maybeSingle();
    if (error)
      throw new AppError(
        "AVAILABILITY_QUERY_FAILED",
        "This operation could not be loaded.",
        500,
      );
    if (!data)
      throw new AppError(
        "NOT_FOUND",
        "This operation is not available to your account.",
        404,
      );
    const result = await reconcileOfferAvailability(
      availabilityOperationSchema.parse(data),
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
