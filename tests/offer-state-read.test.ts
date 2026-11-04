import { describe, expect, it, vi } from "vitest";
import { EldoradoClient } from "@/domains/eldorado/client";
import type { OfferSource } from "@/domains/offers/definitions";

// Seller IDs use .NET GUIDs and need not satisfy an RFC UUID version nibble.
const id = "11111111-1111-1111-1111-111111111111";
const credentials = { clientId: "synthetic", clientSecret: "synthetic" };
const token = () =>
  Response.json({ accessToken: "synthetic-token", expiresIn: 900 });
const envelope = (offerId = id) => ({
  offer: {
    id: offerId,
    offerState: "Paused",
    description: "private fixture content",
    accountDetails: "private fixture content",
  },
  user: { email: "private fixture content" },
  userOrderInfo: { ratings: "private fixture content" },
});

describe("verified individual listing state reads", () => {
  it.each([
    ["flexible", `/api/flexibleOffers/${id}/private`],
    ["predefined", `/api/predefinedOffers/${id}/private`],
    ["currency", `/api/v1/currency-management/me/offers/${id}`],
  ] as const)(
    "returns only listing identity/state for %s",
    async (source, path) => {
      const fetcher: typeof fetch = async (input, options) => {
        if (String(input).endsWith("/token")) return token();
        expect(String(input)).toBe("https://www.eldorado.gg" + path);
        expect(options?.method).toBe("GET");
        expect(options?.redirect).toBe("error");
        expect(options?.body).toBeUndefined();
        return Response.json(envelope());
      };
      const result = await new EldoradoClient(credentials, fetcher).offerState(
        source,
        id,
      );
      expect(result).toEqual({ id, state: "Paused" });
      expect(JSON.stringify(result)).not.toContain("private fixture");
    },
  );

  it("does not enable undocumented routes or turn an identifier into a path", async () => {
    const fetcher = vi.fn();
    const client = new EldoradoClient(credentials, fetcher);
    await expect(client.offerState("items", id)).rejects.toMatchObject({
      code: "OFFER_STATE_READ_UNAVAILABLE",
    });
    await expect(
      client.offerState("https://attacker.example" as OfferSource, id),
    ).rejects.toMatchObject({ code: "OFFER_STATE_READ_UNAVAILABLE" });
    for (const unsafe of ["../../other", id + "/private", "not-a-guid"])
      await expect(client.offerState("flexible", unsafe)).rejects.toMatchObject(
        {
          code: "INVALID_OFFER_ID",
        },
      );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects mismatched and malformed records rather than confirming another listing", async () => {
    for (const payload of [
      envelope("22222222-2222-2222-2222-222222222222"),
      { offer: { id, offerState: null } },
      { id, offerState: "Paused" },
    ]) {
      const fetcher: typeof fetch = async (input) =>
        String(input).endsWith("/token") ? token() : Response.json(payload);
      await expect(
        new EldoradoClient(credentials, fetcher).offerState("flexible", id),
      ).rejects.toMatchObject({ code: "UPSTREAM_CONTRACT" });
    }
  });

  it("refreshes one rejected read token and retries only the same safe individual GET", async () => {
    let auth = 0;
    let reads = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/token")) {
        auth++;
        return token();
      }
      reads++;
      return reads === 1
        ? new Response(null, { status: 401 })
        : Response.json(envelope());
    };
    const client = new EldoradoClient(credentials, fetcher);
    expect(await client.offerState("currency", id)).toEqual({
      id,
      state: "Paused",
    });
    expect(auth).toBe(2);
    expect(reads).toBe(2);
  });

  it("shares rate-limit cooldown with other seller reads", async () => {
    let now = 0;
    let reads = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/token")) return token();
      reads++;
      return new Response("private upstream fixture", {
        status: 429,
        headers: { "Retry-After": "7" },
      });
    };
    const client = new EldoradoClient(credentials, fetcher, () => now);
    await expect(client.offerState("flexible", id)).rejects.toMatchObject({
      code: "ELDORADO_RATE_LIMITED",
    });
    await expect(client.orders()).rejects.toThrow("7 seconds");
    expect(reads).toBe(1);
    now = 7001;
    await expect(client.offerState("flexible", id)).rejects.toMatchObject({
      code: "ELDORADO_RATE_LIMITED",
    });
    expect(reads).toBe(2);
  });
});
