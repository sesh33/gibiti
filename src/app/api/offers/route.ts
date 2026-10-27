import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
import { offerSources } from "@/domains/offers/definitions";
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("offers.read");
    const query = z
      .object({
        source: z.enum(["all", ...offerSources]).default("all"),
        search: z.string().max(100).default(""),
        state: z.string().max(100).default(""),
        cursor: z.string().max(600).optional(),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    let select = staff.db
      .from("offers")
      .select(
        "id,native_id,source,title,category,state,price,currency,quantity,game_id,updated_at",
      )
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (query.source !== "all") select = select.eq("source", query.source);
    if (query.state) select = select.eq("state", query.state);
    if (query.search) {
      const safe = query.search.replace(/[^a-zA-Z0-9 @._-]/g, "");
      if (safe)
        select = select.or(
          `title.ilike.%${safe}%,native_id.ilike.%${safe}%,game_id.ilike.%${safe}%`,
        );
    }
    if (query.cursor) {
      let raw: unknown;
      try {
        raw = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw new AppError(
          "INVALID_CURSOR",
          "The pagination cursor is invalid.",
        );
      }
      const cursor = z
        .object({
          date: z.iso.datetime({ offset: true }),
          id: z.string().regex(/^[a-zA-Z0-9:_-]{1,200}$/),
        })
        .parse(raw);
      select = select.or(
        `updated_at.lt.${cursor.date},and(updated_at.eq.${cursor.date},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await select;
    if (error)
      throw new AppError(
        "OFFER_QUERY_FAILED",
        "Offers could not be loaded. Confirm the offer synchronization migration is applied.",
        500,
      );
    const rows = data ?? [],
      items = rows.slice(0, 50),
      last = items.at(-1);
    const { data: sync } = await staff.db
      .from("integration_sync_state")
      .select("provider,last_success_at,scope,cursor")
      .like("provider", "eldorado-offers:%");
    return NextResponse.json(
      {
        items,
        nextCursor:
          rows.length > 50 && last
            ? Buffer.from(
                JSON.stringify({ date: last.updated_at, id: last.id }),
              ).toString("base64url")
            : null,
        sync: sync ?? [],
        scope:
          "Synchronized read-only listings; upstream pagination contracts remain unverified.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
