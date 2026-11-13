import { expect, it, vi } from "vitest";
import { EldoradoClient } from "@/domains/eldorado/client";
import { safeCsv } from "@/domains/reports/csv";
import { normalizeNotification } from "@/domains/eldorado/seller-tools";
import { policyInput } from "@/domains/pricing/models";
import { unitPrice } from "@/lib/utils";
import { choosePrice } from "@/domains/pricing/quotes";
import type { SellerAction } from "@/domains/eldorado/seller-contracts";
const credentials = { clientId: "fixture", clientSecret: "fixture" };
it.each([
  [{ kind: "seller.online" }, "/api/offerUser/me/switchOnline"],
  [{ kind: "seller.offline" }, "/api/offerUser/me/switchOffline"],
  [
    { kind: "notification.read", notificationId: "fixture-notification" },
    "/api/notifications/me/fixture-notification/markAsRead",
  ],
  [{ kind: "notifications.read_all" }, "/api/notifications/me/markAllAsRead"],
] as const)(
  "uses the documented bodyless Seller command %j",
  async (action, path) => {
    const fetcher = vi.fn(
      async (url: URL | RequestInfo, options?: RequestInit) => {
        if (String(url).endsWith("/token"))
          return Response.json({
            accessToken: "fixture-token",
            expiresIn: 900,
          });
        expect(new URL(String(url)).origin).toBe("https://www.eldorado.gg");
        expect(new URL(String(url)).pathname).toBe(path);
        expect(options?.method).toBe("PUT");
        expect(options?.body).toBeUndefined();
        expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("swagger")).toBe(
          "Swager request",
        );
        return new Response(null, { status: 204 });
      },
    );
    await expect(
      new EldoradoClient(credentials, fetcher).writeSellerAction(
        action as SellerAction,
      ),
    ).resolves.toEqual({ acknowledged: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it.each([401, 403, 429, 500])(
  "never retries a Seller command after HTTP %i",
  async (status) => {
    let writes = 0;
    const client = new EldoradoClient(credentials, async (url) =>
      String(url).endsWith("/token")
        ? Response.json({ accessToken: "fixture", expiresIn: 900 })
        : (writes++,
          new Response(null, { status, headers: { "Retry-After": "120" } })),
    );
    await expect(
      client.writeSellerAction({ kind: "seller.online" }),
    ).rejects.toMatchObject({
      code:
        status === 500 ? "ELDORADO_WRITE_UNKNOWN" : "ELDORADO_WRITE_REJECTED",
    });
    expect(writes).toBe(1);
  },
);
it("checks current authority before sending and never converts an outage to success", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ accessToken: "fixture", expiresIn: 900 }),
  );
  const client = new EldoradoClient(credentials, fetcher);
  await expect(
    client.writeSellerAction({ kind: "seller.offline" }, async () => {
      throw new Error("revoked");
    }),
  ).rejects.toThrow("revoked");
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
  ["sold-orders", "sold-order-data", "application/csv", "csv"],
  ["orders", "order-data", "text/csv", "csv"],
  ["invoice", "invoice/generate", "application/pdf", "pdf"],
] as const)(
  "downloads the official %s format using inclusive UTC dates",
  async (kind, path, contentType, type) => {
    const client = new EldoradoClient(credentials, async (url, options) => {
      if (String(url).endsWith("/token"))
        return Response.json({ accessToken: "fixture", expiresIn: 900 });
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/api/v1/orders/me/" + path);
      expect(parsed.searchParams.get("fromDate")).toBe(
        "2026-11-01T00:00:00.000Z",
      );
      expect(parsed.searchParams.get("untilDate")).toBe(
        "2026-11-13T23:59:59.999Z",
      );
      expect(options?.body).toBeUndefined();
      return new Response(
        type === "pdf" ? "%PDF-1.7\nSynthetic" : "Title,Amount\nSynthetic,1.00",
        { headers: { "Content-Type": contentType } },
      );
    });
    const report = await client.downloadReport({
      kind,
      from: "2026-11-01",
      until: "2026-11-13",
    });
    expect(report.type).toBe(type);
    expect(report.bytes.length).toBeGreaterThan(0);
  },
);
it("blocks unverified download formats, empty bodies and invalid ranges", async () => {
  const client = new EldoradoClient(credentials, async (url) =>
    String(url).endsWith("/token")
      ? Response.json({ accessToken: "fixture", expiresIn: 900 })
      : new Response("<html>edge failure</html>", {
          headers: { "Content-Type": "text/html" },
        }),
  );
  await expect(
    client.downloadReport({
      kind: "orders",
      from: "2026-11-13",
      until: "2026-11-01",
    }),
  ).rejects.toThrow();
  await expect(
    client.downloadReport({
      kind: "orders",
      from: "2026-11-01",
      until: "2026-11-13",
    }),
  ).rejects.toMatchObject({ code: "REPORT_FORMAT_UNVERIFIED" });
});
it("neutralizes spreadsheet formulas while preserving quoted text, newlines and numeric negatives", () => {
  const result = safeCsv(
    'Title,Amount\r\n"=HYPERLINK(""https://example.invalid"")",-1.25\r\n"Hello,\nworld",+12.5\r\n @SUM(A1),1\r\n',
  );
  expect(result).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  expect(result).toContain('"-1.25"');
  expect(result).toContain('"Hello,\nworld"');
  expect(result).toContain('"\' @SUM(A1)"');
  expect(safeCsv("Name;Value\n+cmd;1")).toContain('"\'+cmd";"1"');
  expect(() => safeCsv('Title\n"Unfinished')).toThrow("incomplete CSV");
});
it("minimizes notifications and never passes unknown payloads or HTML as executable markup", () => {
  const normalized = normalizeNotification({
    id: "fixture",
    title: "<script>synthetic</script>",
    message: "Synthetic",
    isRead: false,
    createdDate: "2026-11-13T00:00:00Z",
    privateData: "excluded",
  });
  expect(normalized).not.toHaveProperty("privateData");
  expect(normalized.isRead).toBe(false);
  expect(
    normalizeNotification({ id: "../bad", read: "not a verified boolean" }),
  ).toMatchObject({ id: null, isRead: null });
});
it("retains micro-price differences and requires precision that represents the bid", () => {
  expect(choosePrice(1.99, 1.5, 0.00001, 5)).toBe(1.98999);
  expect(choosePrice(1.99, 1.989999, 0.00001, 5)).toBeGreaterThanOrEqual(
    1.989999,
  );
  expect(unitPrice(1.00001, "USD")).toBe("$1.00001");
  expect(unitPrice(0.00000001, "USD")).toBe("$0.00000001");
  const input = {
    offerId: "predefined:11111111-1111-4111-8111-111111111111",
    floor: 1,
    difference: 0.00001,
    decimals: 5,
    intervalSeconds: 15,
  };
  expect(policyInput.safeParse(input).success).toBe(true);
  expect(policyInput.safeParse({ ...input, decimals: 2 }).success).toBe(false);
  expect(policyInput.safeParse({ ...input, intervalSeconds: 14 }).success).toBe(
    false,
  );
});
