import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { eldoradoClient } from "@/domains/eldorado/client";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const staff = await requireStaff("offers.read"),
      id = z.guid().parse((await params).id);
    const { data: local, error } = await staff.db
      .from("offers")
      .select("id,title,updated_at")
      .eq("id", "predefined:" + id)
      .single();
    if (error || !local)
      throw new AppError(
        "NOT_FOUND",
        "Synchronize this predefined listing first.",
        404,
      );
    return NextResponse.json(
      { local, snapshot: await eldoradoClient().predefinedSnapshot(id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
