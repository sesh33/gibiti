// Every request is intercepted. No real secret or external write is used.
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const project = resolve(import.meta.dirname, "..");
const server = await createServer({
  root: resolve(project, "tests/ui/seller-connection"),
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: 3198,
    strictPort: true,
    fs: { allow: [project] },
  },
  resolve: { alias: { "@": resolve(project, "src") } },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const role of ["OWNER", "SUPPORT_AGENT"]) {
    const page = await browser.newPage();
    let configured = false,
      writes = 0,
      received;
    const secret = "synthetic-browser-secret-not-real";
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      const json = (body) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (path === "/api/me") return json({ profile: { role } });
      if (path === "/api/integrations/eldorado" && request.method() === "GET")
        return json({
          configured,
          clientId: "fixture-client",
          verifiedAt: null,
        });
      if (
        path === "/api/integrations/eldorado" &&
        request.method() === "POST"
      ) {
        writes++;
        received = request.postDataJSON();
        configured = true;
        return json({
          message: "Connected. You can now synchronize orders and offers.",
        });
      }
      if (path === "/api/integrations/eldorado/health")
        return json({
          checkedAt: new Date().toISOString(),
          checks: [
            {
              ok: true,
              name: "notifications",
              value: { unread: 4, hasMore: true },
            },
            { ok: true, name: "pendingReviews", value: 2 },
            { ok: true, name: "restrictions", value: 0 },
          ],
        });
      throw new Error("Unexpected synthetic request: " + path);
    });
    await page.goto("http://127.0.0.1:3198");
    if (role === "OWNER") {
      await page.getByLabel("Eldorado client secret").fill(secret);
      await page
        .getByRole("button", { name: "Verify & connect", exact: true })
        .click();
      await expect(
        page.getByText("Connected. You can now synchronize orders and offers."),
      ).toBeVisible();
      await expect(page.getByLabel("Eldorado client secret")).toHaveValue("");
      assert.equal(writes, 1);
      assert.equal(received.clientSecret, secret);
      assert.equal(
        await page.evaluate(
          (value) => window.connectionCache().includes(value),
          secret,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(
          (value) =>
            JSON.stringify([localStorage, sessionStorage]).includes(value),
          secret,
        ),
        false,
      );
      await page
        .getByRole("button", { name: "Check seller status", exact: true })
        .click();
      await expect(page.getByText("4+", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByLabel("Eldorado client secret")).toHaveCount(0);
      assert.equal(writes, 0);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Connection browser checks passed: Owner form, empty secret field, no cache/storage retention, staff isolation, seller counts. External writes: 0.",
  );
} finally {
  await browser.close();
  await server.close();
}
