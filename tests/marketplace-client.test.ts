import { expect, it, vi } from "vitest";
import { EldoradoClient } from "@/domains/eldorado/client";
import {
  marketplaceChange,
  predefinedInput,
  type MarketplaceChange,
} from "@/domains/eldorado/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const document = {
  details: {
    description: "Synthetic public description",
    guaranteedDeliveryTime: "Minute20",
    pricing: {
      quantity: 10,
      minQuantity: 1,
      volumeDiscounts: [],
      pricePerUnit: { amount: 2, currency: "USD" },
    },
    deliveryMethod: "InGameTrade",
  },
  augmentedGame: {
    gameId: "fixture-game",
    category: "Currency",
    tradeEnvironmentId: null,
    offerAttributes: [],
  },
  giftCardDetails: null,
};
it.each([
  [
    { kind: "offer.price", body: { amount: 2, currency: "USD" } },
    "PUT",
    `/api/predefinedOffersUser/me/${id}/changePrice`,
    JSON.stringify({ amount: 2, currency: "USD" }),
  ],
  [
    { kind: "offer.quantity", body: 5 },
    "PUT",
    `/api/predefinedOffersUser/me/${id}/changeQuantity`,
    "5",
  ],
  [
    { kind: "offer.details", body: document },
    "PUT",
    `/api/predefinedOffers/${id}/details`,
    JSON.stringify(document),
  ],
  [
    { kind: "offer.create", body: document },
    "POST",
    "/api/predefinedOffers",
    JSON.stringify(document),
  ],
  [
    { kind: "order.deliver" },
    "PUT",
    `/api/v1/orders/me/${id}/deliver`,
    undefined,
  ],
  [
    { kind: "order.cancel", body: { reason: "Out_Of_Stock", message: null } },
    "POST",
    `/api/v1/orders/me/${id}/cancel`,
    JSON.stringify({ reason: "Out_Of_Stock", message: null }),
  ],
  [
    {
      kind: "order.extend",
      body: { time: "Hour1", reason: "PreparationDelay", message: null },
    },
    "POST",
    `/api/v1/orders/me/${id}/extend-delivery-time`,
    JSON.stringify({
      time: "Hour1",
      reason: "PreparationDelay",
      message: null,
    }),
  ],
  [
    {
      kind: "order.correct",
      body: { message: "Synthetic corrected public delivery information" },
    },
    "POST",
    `/api/v1/orders/me/${id}/delivery-details/correction`,
    JSON.stringify({
      message: "Synthetic corrected public delivery information",
    }),
  ],
] as const)(
  "uses the supplied write contract for %j",
  async (change, method, path, body) => {
    let writes = 0;
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async (url, options) => {
        if (String(url).endsWith("/token"))
          return Response.json({
            accessToken: "fixture-token",
            expiresIn: 900,
          });
        writes++;
        expect(new URL(String(url)).origin).toBe("https://www.eldorado.gg");
        expect(new URL(String(url)).pathname).toBe(path);
        expect(options?.method).toBe(method);
        expect(options?.body).toBe(body);
        expect(new Headers(options?.headers).get("swagger")).toBe(
          "Swager request",
        );
        expect(options?.redirect).toBe("error");
        return change.kind === "order.extend"
          ? new Response(null, { status: 204 })
          : change.kind === "offer.create"
            ? new Response(null, { status: 201 })
            : Response.json(change.kind === "offer.quantity" ? 5 : {});
      },
    );
    await expect(
      client.writeMarketplace(change as MarketplaceChange, id),
    ).resolves.toMatchObject({ acknowledged: true });
    expect(writes).toBe(1);
  },
);
it.each([401, 403, 429, 500, 408])(
  "never repeats a write after HTTP %i",
  async (status) => {
    let writes = 0;
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async (url) => {
        if (String(url).endsWith("/token"))
          return Response.json({ accessToken: "fixture", expiresIn: 900 });
        writes++;
        return new Response("private provider diagnostics", {
          status,
          headers: { "Retry-After": "30" },
        });
      },
    );
    await expect(
      client.writeMarketplace({ kind: "order.deliver" }, id),
    ).rejects.toMatchObject({
      code: [408, 500].includes(status)
        ? "ELDORADO_WRITE_UNKNOWN"
        : "ELDORADO_WRITE_REJECTED",
    });
    expect(writes).toBe(1);
  },
);
it("does not send malformed quantity, currency, target or undeclared fields", async () => {
  const fetcher = vi.fn();
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
  );
  for (const input of [
    { kind: "offer.quantity", body: { quantity: 5 } },
    { kind: "offer.quantity", body: 1.5 },
    { kind: "offer.price", body: { amount: 2, currency: "BAD" } },
    { kind: "order.deliver", body: {} },
    { kind: "order.cancel", body: { reason: "invented", message: null } },
  ])
    expect(marketplaceChange.safeParse(input).success).toBe(false);
  await expect(
    client.writeMarketplace({ kind: "order.deliver" }, "../other-account"),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(predefinedInput.safeParse({ ...document, extra: true }).success).toBe(
    false,
  );
  expect(
    predefinedInput.safeParse({
      ...document,
      giftCardDetails: [{ secret: "must-not-be-stored" }],
    }).success,
  ).toBe(false);
});
it("does not retry an ambiguous network failure", async () => {
  let writes = 0;
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async (url) => {
      if (String(url).endsWith("/token"))
        return Response.json({ accessToken: "fixture", expiresIn: 900 });
      writes++;
      throw new Error("private network details");
    },
  );
  await expect(
    client.writeMarketplace({ kind: "offer.quantity", body: 0 }, id),
  ).rejects.toMatchObject({ code: "ELDORADO_WRITE_UNKNOWN" });
  expect(writes).toBe(1);
});

it("checks scoped automation authority after authentication and before sending a commercial request", async () => {
  const events: string[] = [];
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async (url) => {
      if (String(url).endsWith("/token")) {
        events.push("authenticate");
        return Response.json({ accessToken: "fixture", expiresIn: 900 });
      }
      events.push("commercial-write");
      return Response.json({});
    },
  );
  await expect(
    client.writeMarketplace({ kind: "order.deliver" }, id, async () => {
      events.push("authority-check");
      throw new Error("authority revoked");
    }),
  ).rejects.toThrow("authority revoked");
  expect(events).toEqual(["authenticate", "authority-check"]);
});

it("persists the entire provider cooldown across server instances without truncating Retry-After", async () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  let notBefore = 0;
  const store = {
    check: async () => {
      if (notBefore > now) throw new Error("shared cooldown");
    },
    defer: vi.fn(async (until: number) => {
      notBefore = Math.max(notBefore, until);
    }),
  };
  const fetcher = vi.fn(async (url: URL | RequestInfo) =>
    String(url).endsWith("/token")
      ? Response.json({ accessToken: "fixture", expiresIn: 900 })
      : new Response(null, { status: 429, headers: { "Retry-After": "7200" } }),
  );
  const first = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
    () => now,
    store,
  );
  await expect(
    first.writeMarketplace({ kind: "order.deliver" }, id),
  ).rejects.toMatchObject({ code: "ELDORADO_WRITE_REJECTED" });
  expect(store.defer).toHaveBeenCalledWith(now + 7200000);
  fetcher.mockClear();
  const second = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
    () => now,
    store,
  );
  await expect(
    second.writeMarketplace({ kind: "order.deliver" }, id),
  ).rejects.toMatchObject({ code: "ELDORADO_WRITE_NOT_SENT" });
  expect(fetcher).not.toHaveBeenCalled();
});
