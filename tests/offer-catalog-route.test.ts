import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rows: [] as unknown[],
  facetError: false,
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: vi.fn(async () => ({
    db: {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        for (const method of [
          "select",
          "order",
          "limit",
          "eq",
          "gt",
          "is",
          "gte",
          "lte",
          "lt",
          "like",
          "ilike",
          "or",
        ])
          builder[method] = (...args: unknown[]) => {
            fixture.calls.push({ table, method, args });
            return builder;
          };
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            resolve({
              data: table === "offers" ? fixture.rows : [],
              error: null,
            }),
          );
        return builder;
      },
      rpc: async () => ({
        data: {
          categories: ["TopUp"],
          games: [],
          states: [],
          regions: [],
          platforms: [],
          denominations: [],
        },
        error: fixture.facetError ? { message: "fixture" } : null,
      }),
    },
  })),
}));
import { GET } from "@/app/api/offers/route";

beforeEach(() => {
  fixture.calls.length = 0;
  fixture.rows = [];
  fixture.facetError = false;
});

it("keeps Unicode and grammar-looking input in a single literal LIKE filter", async () => {
  const params = new URLSearchParams({
    search: "São_100%,(x)",
    category: "TopUp",
    game: "fixture-game",
    region: "Europe",
    platform: "PC",
    denomination: "1000",
    stock: "unknown",
    freshness: "stale",
  });
  const response = await GET(
    new Request(`https://rivox.example/api/offers?${params}`),
  );
  expect(response.status).toBe(200);
  expect(fixture.calls).toContainEqual({
    table: "offers",
    method: "ilike",
    args: ["catalog_search", "%São\\_100\\%,(x)%"],
  });
  expect(fixture.calls.some((call) => call.method === "or")).toBe(false);
  expect(fixture.calls).toContainEqual({
    table: "offers",
    method: "eq",
    args: ["category", "TopUp"],
  });
  expect(fixture.calls).toContainEqual({
    table: "offers",
    method: "eq",
    args: ["catalog_region", "Europe"],
  });
  expect(fixture.calls).toContainEqual({
    table: "offers",
    method: "is",
    args: ["quantity", null],
  });
  expect((await response.json()).facets.categories).toEqual(["TopUp"]);
});

it("retains keyset pagination with literal search and source filters", async () => {
  const cursor = Buffer.from(
    JSON.stringify({ date: "2026-11-15T12:00:00Z", id: "predefined:fixture" }),
  ).toString("base64url");
  const response = await GET(
    new Request(
      `https://rivox.example/api/offers?source=predefined&search=東京&cursor=${cursor}`,
    ),
  );
  expect(response.status).toBe(200);
  expect(fixture.calls.filter((call) => call.method === "or")).toEqual([
    {
      table: "offers",
      method: "or",
      args: [
        "updated_at.lt.2026-11-15T12:00:00Z,and(updated_at.eq.2026-11-15T12:00:00Z,id.lt.predefined:fixture)",
      ],
    },
  ]);
});

it("reports a missing catalog migration instead of showing incomplete facets", async () => {
  fixture.facetError = true;
  const response = await GET(new Request("https://rivox.example/api/offers"));
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("CATALOG_MIGRATION_REQUIRED");
});
