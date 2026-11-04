import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  request: vi.fn(),
  fetch: vi.fn(),
  proxyOptions: [] as unknown[],
}));
vi.mock("undici", () => ({
  request: transport.request,
  fetch: transport.fetch,
  EnvHttpProxyAgent: class {
    constructor(options: unknown) {
      transport.proxyOptions.push(options);
    }
  },
}));

const url = "https://www.eldorado.gg/api/v1/currency-management/me/offers";
const page = {
  pageIndex: 1,
  pageSize: 10,
  recordCount: 0,
  totalPages: 0,
  results: [],
};
const options = {
  method: "GET",
  headers: {
    Authorization: "Bearer synthetic-token",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ augmentedGameFilter: {} }),
  redirect: "error" as const,
};

beforeEach(() => {
  vi.resetModules();
  transport.request.mockReset();
  transport.fetch.mockReset();
  transport.proxyOptions.length = 0;
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"])
    vi.stubEnv(name, "");
  transport.request.mockImplementation(async () => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: Readable.from([Buffer.from(JSON.stringify(page))]),
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("verified currency search HTTP transport", () => {
  it("sends the required GET JSON body without using Fetch or changing the request method", async () => {
    const { currencyOffersFetch } = await import("@/lib/server-fetch");
    const result = await currencyOffersFetch(url, options);
    expect(await result.json()).toEqual(page);
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(transport.request).toHaveBeenCalledExactlyOnceWith(
      url,
      expect.objectContaining({
        method: "GET",
        body: options.body,
        headers: expect.objectContaining({
          authorization: "Bearer synthetic-token",
          "content-type": "application/json",
          "accept-encoding": "identity",
        }),
        headersTimeout: 20_000,
        bodyTimeout: 20_000,
      }),
    );
  });

  it("does not turn this special-case read into an arbitrary URL, query, or body transport", async () => {
    const { currencyOffersFetch } = await import("@/lib/server-fetch");
    for (const target of [
      "https://attacker.example/api/v1/currency-management/me/offers",
      url + "/different",
      url + "?pageIndex=2",
      url + "#fragment",
    ])
      await expect(currencyOffersFetch(target, options)).rejects.toThrow(
        "only its verified read contract",
      );
    for (const change of [
      { method: "POST" },
      { body: "{}" },
      { body: JSON.stringify({ augmentedGameFilter: {}, pageIndex: 2 }) },
      { redirect: "follow" as const },
    ])
      await expect(
        currencyOffersFetch(url, { ...options, ...change }),
      ).rejects.toThrow("only its verified read contract");
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("preserves the supported proxy and loopback exclusions, without disabling TLS verification", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.fixture.test:8080");
    vi.stubEnv("NO_PROXY", "existing.fixture.test");
    const { currencyOffersFetch } = await import("@/lib/server-fetch");
    const result = await currencyOffersFetch(url, options);
    await result.json();
    expect(transport.proxyOptions).toEqual([
      { noProxy: "existing.fixture.test,localhost,127.0.0.1,[::1]" },
    ]);
    expect(transport.request.mock.calls[0][1].dispatcher).toBeDefined();
  });

  it("preserves rate-limit status and Retry-After while dropping upstream cookies", async () => {
    transport.request.mockResolvedValue({
      statusCode: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "12",
        "set-cookie": ["private-cookie=synthetic"],
      },
      body: Readable.from([Buffer.from("{}")]),
    });
    const { currencyOffersFetch } = await import("@/lib/server-fetch");
    const result = await currencyOffersFetch(url, options);
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("12");
    expect(result.headers.has("set-cookie")).toBe(false);
    await result.body?.cancel();
  });

  it("does not follow an upstream redirect or replay bearer credentials", async () => {
    transport.request.mockResolvedValue({
      statusCode: 302,
      headers: { location: "https://attacker.example/collect" },
      body: Readable.from([]),
    });
    const { currencyOffersFetch } = await import("@/lib/server-fetch");
    const result = await currencyOffersFetch(url, options);
    expect(result.status).toBe(302);
    expect(transport.request).toHaveBeenCalledTimes(1);
    await result.body?.cancel();
  });
});

describe("currency search through the authenticated seller client", () => {
  it("uses the same token refresh boundary and parses the actual page contract", async () => {
    const { EldoradoClient } = await import("@/domains/eldorado/client");
    const { parseSellerOfferPage } = await import("@/domains/offers/schemas");
    const calls: { url: string; options?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), options: init });
      if (String(input).endsWith("/token"))
        return Response.json({
          accessToken: "synthetic-token",
          expiresIn: 900,
        });
      return calls.length === 2
        ? new Response(null, { status: 401 })
        : Response.json(page);
    };
    const client = new EldoradoClient(
      { clientId: "synthetic", clientSecret: "synthetic" },
      fetcher,
    );
    expect(
      await client.read(
        "/api/v1/currency-management/me/offers",
        parseSellerOfferPage,
      ),
    ).toEqual(page);
    const searches = calls.filter((call) => call.url === url);
    expect(searches).toHaveLength(2);
    for (const search of searches) {
      expect(search.options?.method).toBe("GET");
      expect(search.options?.body).toBe(options.body);
      expect(search.options?.redirect).toBe("error");
    }
    expect(calls.filter((call) => call.url.endsWith("/token"))).toHaveLength(2);
  });

  it("rejects unverified currency pagination before authenticating", async () => {
    const { EldoradoClient } = await import("@/domains/eldorado/client");
    const fetcher = vi.fn();
    const client = new EldoradoClient(
      { clientId: "synthetic", clientSecret: "synthetic" },
      fetcher,
    );
    await expect(
      client.read("/api/v1/currency-management/me/offers", (value) => value, {
        pageIndex: "2",
      }),
    ).rejects.toMatchObject({ code: "CURRENCY_QUERY_UNVERIFIED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
