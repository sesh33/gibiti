// Isolated browser checks of the actual client component. Every API call is synthetic and intercepted.
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const project = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(project, "tests/ui/offer-availability");
const server = await createServer({
  root: directory,
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: 3199,
    strictPort: true,
    fs: { allow: [project] },
  },
  resolve: {
    alias: [
      {
        find: "next/navigation",
        replacement: resolve(directory, "navigation.ts"),
      },
      { find: "next/link", replacement: resolve(directory, "link.tsx") },
      { find: "@", replacement: resolve(project, "src") },
    ],
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  logLevel: "error",
});
await server.listen();
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox"],
  headless: true,
});
const checks = [];
async function fixture({
  manage = true,
  scenario = "unknown",
  state = "Active",
  overlap = false,
} = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let offerState = state,
    operation,
    payload;
  const counts = { writes: 0, reconciles: 0, recoveryReads: 0 };
  const offerId = "flexible:10000000-0000-4000-8000-000000000001";
  const json = (route, data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/me")
      return json(route, {
        permissions: manage ? ["offers.read", "offers.pause"] : ["offers.read"],
      });
    if (url.pathname === "/api/offers") {
      const row = {
        id: offerId,
        native_id: "10000000-0000-4000-8000-000000000001",
        source: "flexible",
        title: "Synthetic availability listing",
        category: "Account",
        state: offerState,
        price: 12.5,
        currency: "USD",
        quantity: 4,
        game_id: "synthetic-game",
        updated_at: "2026-11-02T12:00:00.000Z",
      };
      const items = [row];
      if (overlap)
        items.push({
          ...row,
          id: "currency:" + row.native_id,
          source: "currency",
          category: "Currency",
          title: "Synthetic overlapping listing",
        });
      return json(route, {
        items,
        nextCursor: null,
        sync: [],
        scope: "Synthetic browser fixture only",
      });
    }
    if (
      url.pathname === "/api/offers/availability" &&
      request.method() === "GET"
    ) {
      if (url.searchParams.has("idempotencyKey")) {
        counts.recoveryReads++;
        return json(route, { operation: operation ?? null });
      }
      return json(route, { items: operation ? [operation] : [] });
    }
    if (
      url.pathname === "/api/offers/availability" &&
      request.method() === "POST"
    ) {
      counts.writes++;
      payload = request.postDataJSON();
      operation = {
        id: "20000000-0000-4000-8000-000000000002",
        offer_id: offerId,
        native_id: "10000000-0000-4000-8000-000000000001",
        action: payload.action,
        status: "unknown",
        observed_state: null,
        error_code: "UPSTREAM_UNCONFIRMED",
        created_at: "2026-11-02T12:01:00.000Z",
      };
      if (scenario === "network") return route.abort("connectionreset");
      return json(
        route,
        {
          operation,
          message:
            "The result is not confirmed. Check before changing this listing again.",
        },
        202,
      );
    }
    if (url.pathname.endsWith("/reconcile") && request.method() === "POST") {
      counts.reconciles++;
      offerState = "Paused";
      operation = {
        ...operation,
        status: "succeeded",
        observed_state: "Paused",
        error_code: null,
      };
      return json(route, {
        operation,
        message:
          "Eldorado reports the requested state. No change was sent again.",
      });
    }
    throw new Error("Unexpected synthetic API request: " + url.pathname);
  });
  await page.goto("http://127.0.0.1:3199");
  await expect(
    page.getByText("Synthetic availability listing", { exact: true }),
  ).toBeVisible();
  return { page, counts, errors, getPayload: () => payload };
}
try {
  {
    const f = await fixture({ manage: false });
    await expect(f.page.getByText("Read only", { exact: true })).toBeVisible();
    await expect(
      f.page.getByRole("button", { name: /^Pause Synthetic/ }),
    ).toHaveCount(0);
    assert.equal(f.counts.writes, 0);
    assert.deepEqual(f.errors, []);
    await f.page.close();
    checks.push("read-only staff cannot see mutation controls");
  }
  {
    const f = await fixture({ state: "Closed" });
    await expect(
      f.page.getByRole("button", { name: /^Unavailable action for/ }),
    ).toBeDisabled();
    assert.equal(f.counts.writes, 0);
    await f.page.close();
    checks.push("unrecognized availability state cannot be changed");
  }
  for (const scenario of ["unknown", "network"]) {
    const f = await fixture({ scenario });
    const pause = f.page.getByRole("button", {
      name: "Pause Synthetic availability listing",
    });
    await expect(pause).toBeEnabled();
    assert.equal(f.counts.writes, 0);
    await pause.click();
    const dialog = f.page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Pause this Eldorado listing?" }),
    ).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: "Confirm pause on Eldorado",
    });
    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: "Reason for this change" })
      .fill("Stock requires manual verification");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await confirm.dblclick();
    await expect(
      dialog.getByRole("button", { name: "Check outcome without resending" }),
    ).toBeEnabled();
    assert.equal(f.counts.writes, 1);
    const payload = f.getPayload();
    assert.equal(
      payload.offerId,
      "flexible:10000000-0000-4000-8000-000000000001",
    );
    assert.equal(payload.action, "pause");
    assert.equal(payload.expectedSnapshot, "2026-11-02T12:00:00.000Z");
    assert.equal(payload.confirm, true);
    assert.match(payload.idempotencyKey, /^[0-9a-f-]{36}$/);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    if (scenario === "unknown") {
      await f.page.reload();
      await expect(
        f.page.getByText("Synthetic availability listing", { exact: true }),
      ).toBeVisible();
      assert.equal(f.counts.writes, 1);
    }
    await f.page
      .getByRole("button", {
        name: "Check availability outcome for Synthetic availability listing",
      })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Confirm pause on Eldorado" }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Check outcome without resending" })
      .click();
    await expect(
      dialog.getByText("Verified in Eldorado", { exact: true }),
    ).toBeVisible();
    assert.equal(f.counts.writes, 1);
    assert.equal(f.counts.reconciles, 1);
    assert.equal(f.counts.recoveryReads, scenario === "network" ? 1 : 0);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(
      f.page.getByRole("button", {
        name: "Resume Synthetic availability listing",
      }),
    ).toBeEnabled();
    assert.deepEqual(f.errors, []);
    await f.page.close();
    checks.push(
      scenario === "network"
        ? "lost response recovers by key and reconciles without repeating write"
        : "explicit confirmation sends once and unknown outcome blocks a second write",
    );
  }
  {
    const f = await fixture({ overlap: true });
    await f.page
      .getByRole("button", { name: "Pause Synthetic availability listing" })
      .click();
    const dialog = f.page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Reason for this change" })
      .fill("Verify stock before accepting sales");
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Confirm pause on Eldorado" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Check outcome without resending" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await f.page
      .getByRole("button", {
        name: "Check availability outcome for Synthetic overlapping listing",
      })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Confirm pause on Eldorado" }),
    ).toHaveCount(0);
    assert.equal(f.counts.writes, 1);
    await dialog
      .getByRole("button", { name: "Check outcome without resending" })
      .click();
    await expect(
      dialog.getByText("Verified in Eldorado", { exact: true }),
    ).toBeVisible();
    assert.equal(f.counts.writes, 1);
    assert.equal(f.counts.reconciles, 1);
    assert.deepEqual(f.errors, []);
    await f.page.close();
    checks.push(
      "overlapping source records share the same unresolved native listing lock",
    );
  }
  const result = { passed: true, checks, realUpstreamWrites: 0 };
  const stateDirectory = resolve(project, ".rivox");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(stateDirectory, "offer-ui-validation.json"),
    JSON.stringify(result),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
}
