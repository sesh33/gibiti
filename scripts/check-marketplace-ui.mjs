// Real components and intercepted APIs. No external mutation is permitted.
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const project = resolve(import.meta.dirname, ".."),
  shim = resolve(project, "tests/ui/offer-availability");
const server = await createServer({
  root: resolve(project, "tests/ui/marketplace"),
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: 3197,
    strictPort: true,
    fs: { allow: [project] },
  },
  resolve: {
    alias: [
      { find: "next/navigation", replacement: resolve(shim, "navigation.ts") },
      { find: "next/link", replacement: resolve(shim, "link.tsx") },
      { find: "@", replacement: resolve(project, "src") },
    ],
  },
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
const id = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222",
  stamp = "2026-11-13T03:00:00.000Z",
  checks = [];
async function fixture(viewer = false) {
  const page = await browser.newPage();
  let price = 1,
    operation;
  const counts = { requests: 0, executions: 0, checks: 0 };
  let lastRequest;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const snapshot = () => ({
    id,
    state: "Active",
    price,
    currency: "USD",
    quantity: 10,
    document: null,
  });
  await page.route("**/api/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/me")
      return json({
        profile: { role: viewer ? "VIEWER" : "OWNER" },
        permissions: viewer
          ? ["offers.read"]
          : [
              "offers.read",
              "offers.update_price",
              "offers.update_stock",
              "offers.create",
            ],
      });
    if (path === "/api/team") return json({ items: [] });
    if (path === `/api/marketplace/offers/${id}`)
      return json({
        local: {
          id: "predefined:" + id,
          title: "Synthetic marketplace listing",
          updated_at: stamp,
        },
        snapshot: snapshot(),
      });
    if (path.endsWith("/comparison"))
      return json({
        items: [],
        page: 1,
        totalPages: 1,
        message:
          "No equivalent package found on this page. No automatic repricing.",
      });
    if (path === "/api/marketplace/requests") {
      counts.requests++;
      lastRequest = r.postDataJSON();
      operation = {
        id: requestId,
        requester_id: "fixture-requester",
        approver_id: "fixture-reviewer",
        action:
          lastRequest.change.kind === "offer.quantity"
            ? "offers.update_stock"
            : "offers.update_price",
        target_id: lastRequest.target,
        reason: lastRequest.reason,
        status: "pending",
        created_at: stamp,
        decision_reason: null,
        payload: {
          marketV1: true,
          change: lastRequest.change,
          before: snapshot(),
        },
      };
      return json({ id: requestId }, 201);
    }
    if (path === "/api/approvals")
      return json({ items: operation ? [operation] : [] });
    if (path === `/api/approvals/${requestId}`) {
      assert.equal(r.method(), "PATCH");
      operation.status = r.postDataJSON().approve ? "approved" : "rejected";
      return json({ message: "Decision recorded." });
    }
    if (path === `/api/marketplace/requests/${requestId}`) {
      const body = r.postDataJSON();
      assert.equal(body.confirm, true);
      if (body.mode === "execute") {
        counts.executions++;
        operation.status = "blocked";
        return json({
          operation,
          message: "The outcome is uncertain. Check status without resending.",
        });
      }
      assert.equal(body.mode, "check");
      counts.checks++;
      operation.status = "succeeded";
      price = 2;
      return json({
        operation,
        message: "The requested result was observed. No change was sent again.",
      });
    }
    if (path === `/api/orders/${id}`)
      return json({
        order: {
          id,
          buyer_username: "Synthetic Buyer",
          product_title: "Synthetic order",
          amount: 1,
          currency: "USD",
          quantity: 1,
          state: "Paid",
          purchased_at: stamp,
          synced_at: stamp,
          conversation_ref: null,
          delivery_time: null,
          delivery_method: "InGameTrade",
          details: { description: "Synthetic fixture only" },
          order_state_history: [],
          order_assignments: [],
          internal_notes: [],
        },
      });
    throw new Error("Unexpected synthetic request: " + path);
  });
  return {
    page,
    counts,
    errors,
    get request() {
      return lastRequest;
    },
  };
}
try {
  const f = await fixture();
  await f.page.goto(`http://127.0.0.1:3197/offers/edit?id=predefined:${id}`);
  await f.page.getByLabel("New unit price (USD)").fill("2");
  await f.page
    .getByLabel("Reason for this change")
    .fill("Verified a manual price adjustment");
  await expect(
    f.page.getByRole("button", { name: "Request independent review" }),
  ).toBeDisabled();
  await f.page
    .getByLabel(
      "I have verified this listing, its values and the requested operation.",
    )
    .check();
  await f.page
    .getByRole("button", { name: "Request independent review" })
    .click();
  await expect(f.page.getByText(/Request recorded/)).toBeVisible();
  assert.deepEqual(f.request.change, {
    kind: "offer.price",
    body: { amount: 2, currency: "USD" },
  });
  assert.equal(f.request.expectedSnapshot, stamp);
  checks.push("typed price request requires confirmation");
  await f.page.getByRole("link", { name: "Open Approvals →" }).click();
  await f.page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    f.page.getByText("Exact requested marketplace change"),
  ).toBeVisible();
  await f.page
    .getByLabel("Decision reason")
    .fill("Reviewed exact target and amount");
  await f.page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await f.page.getByRole("button", { name: "Execute approved change" }).click();
  await expect(
    f.page.getByRole("button", { name: "Execute this approved request once" }),
  ).toBeDisabled();
  await f.page.getByRole("checkbox").check();
  await f.page
    .getByRole("button", { name: "Execute this approved request once" })
    .click();
  await expect(
    f.page.getByRole("button", { name: "Check outcome" }),
  ).toBeVisible();
  assert.equal(f.counts.executions, 1);
  checks.push("review and execution are separate explicit steps");
  await f.page.getByRole("button", { name: "Check outcome" }).click();
  await f.page.getByRole("button", { name: "Read current status" }).click();
  await expect(f.page.getByText(/No change was sent again/)).toBeVisible();
  assert.equal(f.counts.executions, 1);
  assert.equal(f.counts.checks, 1);
  checks.push("unknown result reconciles without repeating execution");
  await f.page.goto(`http://127.0.0.1:3197/offers/edit?id=predefined:${id}`);
  await expect(f.page.getByText("$2.00", { exact: true })).toBeVisible();
  await f.page
    .getByLabel("Operation", { exact: true })
    .selectOption("offer.quantity");
  await f.page.getByLabel("New quantity", { exact: true }).fill("5");
  await f.page
    .getByLabel("Reason for this change")
    .fill("Verified manual quantity change");
  await f.page
    .getByLabel(
      "I have verified this listing, its values and the requested operation.",
    )
    .check();
  await f.page
    .getByRole("button", { name: "Request independent review" })
    .click();
  await expect(f.page.getByText(/Request recorded/)).toBeVisible();
  assert.deepEqual(f.request.change, { kind: "offer.quantity", body: 5 });
  checks.push("quantity request preserves JSON integer contract");
  assert.deepEqual(f.errors, []);
  await f.page.close();
  const viewer = await fixture(true);
  await viewer.page.goto(
    `http://127.0.0.1:3197/offers/edit?id=predefined:${id}`,
  );
  await expect(
    viewer.page.getByRole("button", { name: "Request independent review" }),
  ).toBeDisabled();
  assert.equal(viewer.counts.requests, 0);
  await viewer.page.close();
  checks.push("read-only staff cannot request edits");
  const order = await fixture();
  await order.page.goto(`http://127.0.0.1:3197/orders/${id}`);
  await order.page
    .getByRole("button", { name: "Request cancellation" })
    .click();
  await order.page
    .getByLabel("Reason", { exact: true })
    .fill("Reviewed buyer request and order status");
  await order.page
    .getByRole("button", { name: "Confirm approval request" })
    .click();
  await expect(order.page.getByText(/Approval requested/)).toBeVisible();
  assert.deepEqual(order.request.change, {
    kind: "order.cancel",
    body: { reason: "Out_Of_Stock", message: null },
  });
  assert.equal(order.request.expectedSnapshot, stamp);
  assert.deepEqual(order.errors, []);
  await order.page.close();
  checks.push("order cancellation uses a typed reason and nullable message");
  const creation = await fixture();
  await creation.page.goto("http://127.0.0.1:3197/offers/edit");
  await creation.page
    .getByLabel("Verified game ID", { exact: true })
    .fill("fixture-game");
  await creation.page
    .getByLabel("Public description", { exact: true })
    .fill("Synthetic public product description");
  await creation.page.getByLabel("Offer unit price", { exact: true }).fill("3");
  await creation.page.getByLabel("Offer stock", { exact: true }).fill("15");
  await creation.page
    .getByLabel("Reason for this change")
    .fill("Reviewed new product details and game IDs");
  await creation.page
    .getByLabel(
      "I have verified this listing, its values and the requested operation.",
    )
    .check();
  await creation.page
    .getByRole("button", { name: "Request independent review" })
    .click();
  await expect(creation.page.getByText(/Request recorded/)).toBeVisible();
  assert.equal(creation.request.change.kind, "offer.create");
  assert.equal(
    creation.request.change.body.details.pricing.pricePerUnit.amount,
    3,
  );
  assert.equal(creation.request.change.body.details.pricing.quantity, 15);
  assert.equal(
    creation.request.change.body.augmentedGame.gameId,
    "fixture-game",
  );
  assert.deepEqual(creation.errors, []);
  await creation.page.close();
  checks.push("graphical creation form preserves the exact predefined DTO");
  const extension = await fixture();
  await extension.page.goto(`http://127.0.0.1:3197/orders/${id}`);
  await extension.page
    .getByRole("button", { name: "Request deadline extension" })
    .click();
  await extension.page
    .getByLabel("Reason", { exact: true })
    .fill("Reviewed delivery schedule with buyer");
  await extension.page.getByRole("combobox").nth(0).selectOption("Hour3");
  await extension.page
    .getByRole("combobox")
    .nth(1)
    .selectOption("WaitingForBuyer");
  await extension.page
    .getByRole("button", { name: "Confirm approval request" })
    .click();
  await expect(extension.page.getByText(/Approval requested/)).toBeVisible();
  assert.deepEqual(extension.request.change, {
    kind: "order.extend",
    body: { time: "Hour3", reason: "WaitingForBuyer", message: null },
  });
  assert.deepEqual(extension.errors, []);
  await extension.page.close();
  checks.push("deadline extension uses documented time and reason enums");
  console.log(JSON.stringify({ passed: true, checks, externalWrites: 0 }));
} finally {
  await browser.close();
  await server.close();
}
