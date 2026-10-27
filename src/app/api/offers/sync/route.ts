import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
import { offerSources } from "@/domains/offers/definitions";
import { synchronizeOfferPage } from "@/domains/offers/service";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.read");
    const { source } = z
      .object({ source: z.enum(["all", ...offerSources]).default("all") })
      .parse(await readBody(request));
    const { data: allowed, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "operations.write",
      max_hits: 30,
      window_seconds: 60,
    });
    if (error || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before synchronizing more listings.",
        429,
      );
    const sources = source === "all" ? [...offerSources] : [source];
    const results = await Promise.all(
      sources.map(async (selected) => {
        try {
          return {
            ok: true as const,
            ...(await synchronizeOfferPage(
              staff.user.id,
              staff.sessionId,
              selected,
            )),
          };
        } catch (error) {
          return {
            ok: false as const,
            source: selected,
            error:
              error instanceof AppError
                ? { code: error.code, message: error.message }
                : {
                    code: "OFFER_SYNC_FAILED",
                    message: "This offer category could not be synchronized.",
                  },
          };
        }
      }),
    );
    return NextResponse.json(
      { results, upstreamWrites: false },
      {
        status: results.every((result) => !result.ok) ? 502 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
