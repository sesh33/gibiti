import { it, expect } from "vitest";
import { EldoradoClient } from "@/domains/eldorado/client";
import { normalizeOrder } from "@/domains/orders/service";
const synthetic = {
  id: "11111111-1111-4111-8111-111111111111",
  purchaseQuantity: 1,
  buyerUsername: "Synthetic buyer",
  totalPrice: { amount: 10, currency: "USD" },
  state: { state: "Paid" },
  orderOfferDetails: { offerTitle: "Fixture product" },
  createdDate: "2026-10-27T12:00:00Z",
};
it("shares a concurrent token refresh and renews before expiration", async () => {
  let auth = 0,
    now = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/token")) {
      auth++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ accessToken: "synthetic-token", expiresIn: 900 });
    }
    return Response.json({ results: [synthetic] });
  };
  const client = new EldoradoClient(
    {
      clientId: "synthetic-id",
      clientSecret: "synthetic-fixture-not-a-secret",
    },
    fetcher,
    () => now,
  );
  await Promise.all([client.orders(), client.orders(), client.orders()]);
  expect(auth).toBe(1);
  now = 841000;
  await client.orders();
  expect(auth).toBe(2);
});
it("retries a read once after a rejected token and preserves cursor", async () => {
  let auth = 0,
    reads = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/token")) {
      auth++;
      return Response.json({ accessToken: "fixture-token", expiresIn: 900 });
    }
    reads++;
    expect(new URL(String(input)).searchParams.get("cursor")).toBe(
      "fixture-cursor",
    );
    return reads === 1
      ? new Response(null, { status: 401 })
      : Response.json({ results: [] });
  };
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
    Date.now,
    { cursorParameter: "cursor" },
  );
  await client.orders("fixture-cursor");
  expect(auth).toBe(2);
  expect(reads).toBe(2);
});
it("rejects malformed pages before persistence and redacts raw upstream errors", async () => {
  const malformed: typeof fetch = async (input) =>
    String(input).endsWith("/token")
      ? Response.json({ accessToken: "fixture", expiresIn: 900 })
      : Response.json({ results: [{ ...synthetic, totalPrice: null }] });
  await expect(
    new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      malformed,
    ).orders(),
  ).rejects.toThrow("No records were synchronized");
  const denied: typeof fetch = async () =>
    new Response("private upstream content", { status: 403 });
  await expect(
    new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      denied,
    ).orders(),
  ).rejects.toThrow("HTTP 403");
});
it("drops tracking data and never persists the raw buyer payload", async () => {
  const { upstreamOrder } = await import("@/domains/eldorado/client");
  const parsed = upstreamOrder.parse({
    ...synthetic,
    userRequestDetails: { ipAddress: "private", emailAddress: "private" },
    accessToken: "private",
  });
  const normalized = normalizeOrder(parsed);
  expect(JSON.stringify(normalized)).not.toContain("private");
  expect(normalized.product_title).toBe("Fixture product");
});

it("refuses to guess an undocumented upstream pagination parameter", async () => {
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async () => {
      throw new Error("Should not call upstream");
    },
  );
  await expect(client.orders("cursor")).rejects.toThrow(
    "ELDORADO_CURSOR_PARAMETER",
  );
});
