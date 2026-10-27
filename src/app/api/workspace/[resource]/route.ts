import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { calculateMetrics } from "@/domains/analytics/service";
import { eldoradoConfigured } from "@/domains/eldorado/client";
import { AppError, errorResponse } from "@/lib/errors";
import type { Permission } from "@/domains/authorization/permissions";
const resources: Record<
  string,
  { permission: Permission; table: string; columns: string }
> = {
  offers: { permission: "offers.read", table: "offers", columns: "*" },
  activity: {
    permission: "audit.read",
    table: "audit_logs",
    columns: "id,actor_id,action,target_type,target_id,metadata,created_at",
  },
  sync: {
    permission: "orders.read",
    table: "integration_sync_state",
    columns: "*",
  },
};
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await params;
    if (resource === "settings") {
      const staff = await requireStaff("settings.manage");
      const { data: errors } = await staff.db
        .from("integration_errors")
        .select("provider,code,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      const { data: sync } = await staff.db
        .from("integration_sync_state")
        .select("provider,last_success_at");
      return NextResponse.json(
        {
          eldoradoVerified: Boolean(
            sync?.some(
              (item) => item.provider === "eldorado" && item.last_success_at,
            ),
          ),
          offersVerifiedSources:
            sync
              ?.filter(
                (item) =>
                  item.provider.startsWith("eldorado-offers:") &&
                  item.last_success_at,
              )
              .map((item) => item.provider.replace("eldorado-offers:", "")) ??
            [],
          eldorado: eldoradoConfigured(),
          messaging: false,
          database: true,
          errors: errors ?? [],
          liveWrites: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (resource === "analytics") {
      const staff = await requireStaff("analytics.read");
      const { data, error } = await staff.db
        .from("orders")
        .select("amount,currency,state,purchased_at")
        .order("purchased_at", { ascending: false })
        .limit(1000);
      if (error)
        throw new AppError(
          "QUERY_FAILED",
          "Analytics could not be calculated.",
          500,
        );
      return NextResponse.json(
        { ...calculateMetrics(data ?? []), limit: 1000 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const config = resources[resource];
    if (!config) throw new AppError("NOT_FOUND", "Resource not found.", 404);
    const staff = await requireStaff(config.permission);
    const { data, error } = await staff.db
      .from(config.table)
      .select(config.columns)
      .limit(100);
    if (error)
      throw new AppError(
        "QUERY_FAILED",
        "The resource could not be loaded.",
        500,
      );
    return NextResponse.json(
      { items: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
