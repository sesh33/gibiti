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
    expect(new URL(String(input)).searchParams.get("cursorValue")).toBe(
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

it("accepts documented nullable cancellation and dispute messages", async () => {
  const { upstreamOrder } = await import("@/domains/eldorado/client");
  const parsed = upstreamOrder.parse({
    ...synthetic,
    cancelation: { reason: "Mutual_Agreement", message: null },
    latestDispute: { reason: "Other", message: null },
  });
  expect(parsed.cancelation?.message).toBeNull();
  expect(parsed.latestDispute?.message).toBeNull();
});

it("uses the supplied selling-order cursor contract", async () => {
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async (input) => {
      if (String(input).endsWith("/token"))
        return Response.json({ accessToken: "fixture", expiresIn: 900 });
      const query = new URL(String(input)).searchParams;
      expect(query.get("displayFilter")).toBe("DisplaySellingOrders");
      expect(query.get("cursorValue")).toBe("next-cursor");
      expect(query.get("pageDirection")).toBe("Previous");
      expect(query.get("pageSize")).toBe("50");
      expect(query.has("pageIndex")).toBe(false);
      return Response.json({ results: [] });
    },
  );
  await client.orders("next-cursor", "Previous");
});

it("uses the canonical origin directly and normalizes documented nullable product titles", async () => {
  const fetcher: typeof fetch = async (input, options) => {
    expect(new URL(String(input)).origin).toBe("https://www.eldorado.gg");
    expect(options?.redirect).toBe("error");
    if (String(input).endsWith("/token"))
      return Response.json({ accessToken: "fixture", expiresIn: 900 });
    return Response.json({
      results: [
        {
          ...synthetic,
          orderOfferDetails: {
            offerTitle: null,
            gameCategoryTitle: "Synthetic game",
            category: "Currency",
            gameId: null,
            description: null,
          },
        },
      ],
    });
  };
  const page = await new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
  ).orders();
  expect(page.results[0].orderOfferDetails.offerTitle).toBe(
    "Synthetic game · Currency",
  );
});

it("reads only documented paths and never sends a token to an arbitrary URL", async () => {
  let requests = 0;
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async () => {
      requests++;
      return Response.json({});
    },
  );
  await expect(
    client.read("https://attacker.example/api", (value) => value),
  ).rejects.toThrow("not an enabled documented");
  await expect(
    client.read("/api/internal/chat", (value) => value),
  ).rejects.toThrow("not an enabled documented");
  expect(requests).toBe(0);
});

it("honors Retry-After and blocks new reads during the shared cooldown", async () => {
  let now = 0,
    reads = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/token"))
      return Response.json({ accessToken: "fixture", expiresIn: 900 });
    reads++;
    return reads === 1
      ? new Response("private upstream detail", {
          status: 429,
          headers: { "Retry-After": "5" },
        })
      : Response.json({ results: [] });
  };
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    fetcher,
    () => now,
  );
  await expect(client.orders()).rejects.toMatchObject({
    code: "ELDORADO_RATE_LIMITED",
    status: 429,
  });
  await expect(client.orders()).rejects.toThrow("5 seconds");
  expect(reads).toBe(1);
  now = 5001;
  expect((await client.orders()).results).toEqual([]);
  expect(reads).toBe(2);
});

it("redacts network and malformed JSON errors and does not retry unsupported reads", async () => {
  const unreachable = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async () => {
      throw new Error("private transport detail");
    },
  );
  await expect(unreachable.orders()).rejects.toMatchObject({
    code: "ELDORADO_UNREACHABLE",
  });
  const nonJson = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async () => new Response("private invalid JSON"),
  );
  await expect(nonJson.orders()).rejects.toThrow("invalid JSON response");
  let attempts = 0;
  const denied = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async (input) => {
      if (String(input).endsWith("/token"))
        return Response.json({ accessToken: "fixture", expiresIn: 900 });
      attempts++;
      return new Response("private upstream detail", { status: 403 });
    },
  );
  await expect(denied.orders()).rejects.toThrow("HTTP 403");
  expect(attempts).toBe(1);
});

it("does not repeatedly refresh after a second 401", async () => {
  let auth = 0,
    reads = 0;
  const client = new EldoradoClient(
    { clientId: "fixture", clientSecret: "fixture" },
    async (input) => {
      if (String(input).endsWith("/token")) {
        auth++;
        return Response.json({
          accessToken: "fixture-" + auth,
          expiresIn: 900,
        });
      }
      reads++;
      return new Response(null, { status: 401 });
    },
  );
  await expect(client.orders()).rejects.toMatchObject({
    code: "ELDORADO_ACCESS_EXPIRED",
    status: 502,
    message: "Eldorado read returned HTTP 401.",
  });
  expect(auth).toBe(2);
  expect(reads).toBe(2);
});

it.each([
  [403, "ELDORADO_ACCESS_DENIED"],
  [404, "ELDORADO_READ_NOT_FOUND"],
  [500, "ELDORADO_SERVICE_UNAVAILABLE"],
  [503, "ELDORADO_SERVICE_UNAVAILABLE"],
  [400, "ELDORADO_REQUEST_FAILED"],
] as const)(
  "classifies HTTP %i reads without retrying or exposing provider diagnostics",
  async (status, code) => {
    let reads = 0;
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async (input) => {
        if (String(input).endsWith("/token"))
          return Response.json({ accessToken: "fixture", expiresIn: 900 });
        reads++;
        return new Response("private-provider-body", { status });
      },
    );
    const error = await client.orders().catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code,
      status: 502,
      message: `Eldorado read returned HTTP ${status}.`,
    });
    expect(String(error)).not.toContain("private-provider-body");
    expect(reads).toBe(1);
  },
);

it.each([
  [401, "ELDORADO_AUTH_REJECTED"],
  [403, "ELDORADO_AUTH_REJECTED"],
  [400, "ELDORADO_AUTH_FAILED"],
  [500, "ELDORADO_AUTH_FAILED"],
] as const)(
  "classifies HTTP %i token failures without retrying or exposing response bodies",
  async (status, code) => {
    let requests = 0;
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async () => {
        requests++;
        return new Response("private-token-response", { status });
      },
    );
    const error = await client.orders().catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code,
      status: 502,
      message: `Eldorado authentication returned HTTP ${status}.`,
    });
    expect(String(error)).not.toContain("private-token-response");
    expect(requests).toBe(1);
  },
);
