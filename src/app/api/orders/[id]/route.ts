import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const staff = await requireStaff();
    const id = z.uuid().parse((await params).id);
    const { data, error } = await staff.db
      .from("orders")
      .select("*,order_state_history(*),order_assignments(*),internal_notes(*)")
      .eq("id", id)
      .single();
    if (error || !data)
      throw new AppError(
        "NOT_FOUND",
        "Order not found or not assigned to you.",
        404,
      );
    return NextResponse.json(
      { order: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
