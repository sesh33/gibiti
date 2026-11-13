import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, retryQuery } from "@/lib/api-client";
afterEach(() => vi.unstubAllGlobals());
it("handles plain-text edge throttling without displaying raw responses or retrying", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("Calm down cowboy. private edge diagnostics", {
          status: 429,
        }),
    ),
  );
  const error = await api("/api/offers").catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as Error).message).toBe(
    "Too many requests. Wait a minute before trying again.",
  );
  expect(retryQuery(0, error as Error)).toBe(false);
});
it("preserves structured permission errors and does not retry unauthorized requests", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Your staff permissions do not allow this action.",
        },
      },
      { status: 403 },
    ),
  );
  const error = await api("/api/offers").catch((error: unknown) => error);
  expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
  expect(retryQuery(0, error as Error)).toBe(false);
});
it("reports an invalid successful response and limits transient retries", async () => {
  vi.stubGlobal("fetch", async () => new Response("<html>edge page</html>"));
  await expect(api("/api/offers")).rejects.toMatchObject({
    status: 502,
    code: "INVALID_RESPONSE",
  });
  expect(
    retryQuery(0, new ApiError("Temporary failure", 503, "UNAVAILABLE")),
  ).toBe(true);
  expect(retryQuery(1, new Error())).toBe(false);
});

it("preserves explicit per-source failure results without accepting a plain-text edge error", async () => {
  const body = {
    results: [
      {
        ok: false,
        source: "predefined",
        error: {
          code: "ELDORADO_RATE_LIMITED",
          message: "Wait before trying again.",
        },
      },
    ],
  };
  vi.stubGlobal("fetch", async () => Response.json(body, { status: 502 }));
  const accept = (data: unknown) =>
    !!data &&
    typeof data === "object" &&
    "results" in data &&
    Array.isArray(data.results);
  expect(await api("/api/offers/sync", undefined, accept)).toEqual(body);
  vi.stubGlobal(
    "fetch",
    async () => new Response("Calm down cowboy", { status: 429 }),
  );
  await expect(
    api("/api/offers/sync", undefined, accept),
  ).rejects.toMatchObject({ status: 429 });
});
