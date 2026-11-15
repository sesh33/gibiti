import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { calculateMetrics } from "@/domains/analytics/service";
import { eldoradoConfigured } from "@/domains/eldorado/client";
import {
  integrationIssue,
  integrationSnapshot,
} from "@/domains/eldorado/integration-health";
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
      const [connected, errorsResult, syncResult, latestErrorsResult] =
        await Promise.all([
          eldoradoConfigured(),
          staff.db
            .from("integration_errors")
            .select("provider,code,created_at")
            .order("created_at", { ascending: false })
            .limit(25),
          staff.db
            .from("integration_sync_state")
            .select("provider,last_success_at,cursor,scope"),
          staff.db.rpc("integration_latest_errors"),
        ]);
      if (errorsResult.error || syncResult.error || latestErrorsResult.error)
        throw new AppError(
          "INTEGRATION_HEALTH_UNAVAILABLE",
          "Integration history could not be checked. No healthy status was inferred. Ask an administrator to check database access and migrations.",
          503,
        );
      const sync = syncResult.data ?? [],
        errors = errorsResult.data ?? [],
        integration = integrationSnapshot(sync, latestErrorsResult.data ?? []);
      return NextResponse.json(
        {
          eldoradoVerified: integration.sources.some(
            (item) => item.provider === "eldorado" && item.lastSuccessAt,
          ),
          offersVerifiedSources: integration.sources
            .filter(
              (item) =>
                item.provider.startsWith("eldorado-offers:") &&
                item.lastSuccessAt,
            )
            .map((item) => item.provider.replace("eldorado-offers:", "")),
          eldorado: connected,
          messaging: false,
          database: true,
          errors: errors
            .filter((error) =>
              integration.sources.some(
                (source) => source.provider === error.provider,
              ),
            )
            .map((error) => ({
              provider: error.provider,
              created_at: error.created_at,
              ...integrationIssue(error.code),
              resolved: integration.sources.some(
                (source) =>
                  source.provider === error.provider &&
                  source.lastSuccessAt !== null &&
                  Date.parse(source.lastSuccessAt) >
                    Date.parse(error.created_at),
              ),
            })),
          liveWrites: connected,
          availabilityActions: connected,
          integration,
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
