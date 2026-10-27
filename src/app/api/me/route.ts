import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff();
    return NextResponse.json(
      { profile: staff.profile, permissions: [...staff.permissions] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
