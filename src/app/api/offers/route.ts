import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
import {
  catalogQuery,
  CATALOG_FRESHNESS_MS,
  escapeLikeSearch,
} from "@/domains/offers/catalog";
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("offers.read");
    const query = catalogQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    let select = staff.db
      .from("offers")
      .select(
        "id,native_id,source,title,category,state,price,currency,quantity,game_id,updated_at,game_category_title,min_quantity,unit_system,delivery_time,delivery_method,public_context,catalog_region,catalog_platform,catalog_denomination,catalog_tagged_at",
      )
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (query.source !== "all") select = select.eq("source", query.source);
    if (query.state) select = select.eq("state", query.state);
    for (const [key, column] of [
      ["category", "category"],
      ["game", "game_id"],
      ["region", "catalog_region"],
      ["platform", "catalog_platform"],
      ["denomination", "catalog_denomination"],
      ["delivery", "delivery_time"],
    ] as const)
      if (query[key]) select = select.eq(column, query[key]);
    if (query.search)
      select = select.ilike(
        "catalog_search",
        `%${escapeLikeSearch(query.search)}%`,
      );
    if (query.stock === "positive") select = select.gt("quantity", 0);
    if (query.stock === "empty") select = select.eq("quantity", 0);
    if (query.stock === "unknown") select = select.is("quantity", null);
    const recentSince = new Date(
      Date.now() - CATALOG_FRESHNESS_MS,
    ).toISOString();
    if (query.freshness === "recent")
      select = select
        .gte("updated_at", recentSince)
        .lte("updated_at", new Date().toISOString());
    if (query.freshness === "stale")
      select = select.lt("updated_at", recentSince);
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
    const [
      { data: sync, error: syncError },
      { data: facets, error: facetsError },
    ] = await Promise.all([
      staff.db
        .from("integration_sync_state")
        .select("provider,last_success_at,scope,cursor")
        .like("provider", "eldorado-offers:%"),
      staff.db.rpc("offer_catalog_facets"),
    ]);
    if (syncError)
      throw new AppError(
        "SYNC_STATUS_UNAVAILABLE",
        "Catalog synchronization status could not be checked. Refresh later.",
        503,
      );
    if (facetsError)
      throw new AppError(
        "CATALOG_MIGRATION_REQUIRED",
        "Catalog filters could not be loaded. Apply the top-up catalog database migration and retry.",
        503,
      );
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
        facets,
        freshnessMinutes: CATALOG_FRESHNESS_MS / 60000,
        scope:
          "Synchronized source records may overlap. Predefined source pages can be selected during sync. Other source pagination is not enabled. Edits require their own permissions and confirmation.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
