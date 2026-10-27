import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(request: Request) {
  try {
    const staff = await requireStaff();
    if (
      !staff.permissions.has("orders.read") &&
      !staff.permissions.has("orders.read_assigned")
    )
      throw new AppError("FORBIDDEN", "Order access is required.", 403);
    const params = new URL(request.url).searchParams;
    const input = z
      .object({
        search: z.string().max(100).default(""),
        state: z.string().max(40).default("all"),
        cursor: z.string().max(300).optional(),
        sort: z.enum(["newest", "oldest"]).default("newest"),
      })
      .parse(Object.fromEntries(params));
    let query = staff.db
      .from("orders")
      .select(
        "id,buyer_username,product_title,quantity,amount,currency,state,purchased_at,synced_at,conversation_ref,order_assignments(user_id)",
      )
      .order("purchased_at", { ascending: input.sort === "oldest" })
      .order("id", { ascending: input.sort === "oldest" })
      .limit(51);
    if (input.search) {
      const safe = input.search.replace(/[^a-zA-Z0-9 @._-]/g, "");
      if (safe)
        query = query.or(
          `buyer_username.ilike.%${safe}%,product_title.ilike.%${safe}%`,
        );
    }
    if (input.state !== "all") query = query.eq("state", input.state);
    if (input.cursor) {
      let raw: unknown;
      try {
        raw = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw new AppError(
          "INVALID_CURSOR",
          "The pagination cursor is invalid.",
        );
      }
      const cursor = z
        .object({ date: z.iso.datetime(), id: z.uuid() })
        .parse(raw);
      const op = input.sort === "oldest" ? "gt" : "lt";
      query = query.or(
        `purchased_at.${op}.${cursor.date},and(purchased_at.eq.${cursor.date},id.${op}.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error)
      throw new AppError("QUERY_FAILED", "Orders could not be loaded.", 500);
    const rows = data ?? [],
      items = rows.slice(0, 50),
      last = items.at(-1);
    return NextResponse.json(
      {
        items,
        nextCursor:
          rows.length > 50 && last
            ? Buffer.from(
                JSON.stringify({ date: last.purchased_at, id: last.id }),
              ).toString("base64url")
            : null,
        scope: "Synchronized records visible to your account.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
