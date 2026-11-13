import { expect, it, vi } from "vitest";
import { EldoradoClient } from "@/domains/eldorado/client";
import { readSellerHealth } from "@/domains/eldorado/health";
function fixture(malformed = false) {
  const calls: string[] = [];
  const fetcher: typeof fetch = vi.fn(async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/token"))
      return Response.json({ accessToken: "fixture", expiresIn: 900 });
    expect(options?.method).toBe("GET");
    if (url.endsWith("/unread-count"))
      return Response.json(
        malformed
          ? { unread: "private-invalid-value", hasMore: false }
          : { unread: 4, hasMore: true },
      );
    if (url.endsWith("/pending-review-order-count")) return Response.json(2);
    if (url.endsWith("/restrictions"))
      return Response.json([{ confidentialDetail: "private-seller-data" }]);
    throw new Error("Unexpected request");
  });
  return {
    client: new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      fetcher,
    ),
    calls,
  };
}
it("uses official reads and returns counts without exposing seller restrictions or notification details", async () => {
  const { client, calls } = fixture();
  const result = await readSellerHealth(client);
  expect(result.checks).toEqual([
    { ok: true, name: "notifications", value: { unread: 4, hasMore: true } },
    { ok: true, name: "pendingReviews", value: 2 },
    { ok: true, name: "restrictions", value: 1 },
  ]);
  expect(JSON.stringify(result)).not.toContain("private-seller-data");
  expect(calls.filter((url) => url.endsWith("/token"))).toHaveLength(1);
});
it("isolates malformed upstream contracts and keeps the verified counts", async () => {
  const { client } = fixture(true);
  const result = await readSellerHealth(client);
  expect(result.checks[0]).toEqual({
    ok: false,
    name: "notifications",
    code: "UPSTREAM_CONTRACT",
  });
  expect(result.checks[1]).toMatchObject({ ok: true, value: 2 });
  expect(JSON.stringify(result)).not.toContain("private-invalid-value");
});
