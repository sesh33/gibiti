import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
  seller: vi.fn(),
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: mocks.staff,
}));
vi.mock("@/domains/eldorado/client", () => ({
  eldoradoClient: () => ({ downloadReport: mocks.download }),
}));
vi.mock("@/domains/eldorado/seller-tools", () => ({
  executeSellerAction: mocks.seller,
}));
import { POST as REPORT } from "@/app/api/reports/download/route";
import { POST as ACTION } from "@/app/api/seller/actions/route";
const origin = "https://rivox.example";
function req(path: string, body: unknown, from = origin) {
  return new Request(origin + path, {
    method: "POST",
    headers: { Origin: from, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  mocks.staff.mockResolvedValue({
    permissions: new Set(["reports.export", "orders.read"]),
    db: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.download.mockResolvedValue({
    type: "csv",
    bytes: Buffer.from("Title,Amount\n=cmd,1"),
  });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects foreign-origin exports and Seller actions before touching staff or upstream", async () => {
  expect(
    (await REPORT(req("/api/reports/download", {}, "https://foreign.example")))
      .status,
  ).toBe(403);
  expect(
    (await ACTION(req("/api/seller/actions", {}, "https://foreign.example")))
      .status,
  ).toBe(403);
  expect(mocks.staff).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.seller).not.toHaveBeenCalled();
});
it("requires authenticated MFA export access and full order visibility before upstream", async () => {
  mocks.staff.mockRejectedValueOnce(
    new AppError("MFA_REQUIRED", "Verify MFA.", 403),
  );
  expect((await REPORT(req("/api/reports/download", {}))).status).toBe(403);
  expect(mocks.staff).toHaveBeenCalledWith("reports.export", true);
  mocks.staff.mockResolvedValueOnce({
    permissions: new Set(["reports.export", "orders.read_assigned"]),
  });
  expect((await REPORT(req("/api/reports/download", {}))).status).toBe(403);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("releases only audited spreadsheet-safe files with private download headers", async () => {
  const response = await REPORT(
    req("/api/reports/download", {
      kind: "orders",
      from: "2026-11-01",
      until: "2026-11-13",
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain(
    'attachment; filename="eldorado-orders-',
  );
  expect(await response.text()).toContain('"\'=cmd"');
  expect(mocks.rpc).toHaveBeenCalledWith(
    "record_report_export",
    expect.objectContaining({ report_kind: "orders" }),
  );
});
it("withholds a fetched report if the audit or current authority fails", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ error: { message: "synthetic" } });
  const response = await REPORT(
    req("/api/reports/download", {
      kind: "orders",
      from: "2026-11-01",
      until: "2026-11-13",
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("=cmd");
});
