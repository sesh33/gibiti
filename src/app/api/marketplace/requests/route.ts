import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { requestMarketOperation } from "@/domains/eldorado/operations";
import { requireSameOrigin, readBody } from "@/lib/http";
import { errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff();
    return NextResponse.json(
      await requestMarketOperation(await readBody(request), staff),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
