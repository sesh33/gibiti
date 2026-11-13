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
    operation,
    policy,
    lastPolicy,
    lastAuthorization;
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
        profile: { id: "fixture-requester", role: viewer ? "VIEWER" : "OWNER" },
        permissions: viewer
          ? ["offers.read"]
          : [
              "offers.read",
              "offers.update_price",
              "offers.update_stock",
              "offers.create",
              "seller.read",
              "seller.manage",
              "notifications.read",
              "notifications.manage",
              "reports.export",
              "orders.read",
            ],
      });
    if (path === "/api/team") return json({ items: [] });
    if (path === "/api/seller")
      return json({
        checks: [
          { name: "eligibility", ok: true, value: true },
          { name: "restrictions", ok: true, value: [] },
          { name: "unread", ok: true, value: { unread: 1, hasMore: false } },
          { name: "pendingReviews", ok: true, value: 0 },
        ],
        checkedAt: stamp,
      });
    if (path === "/api/seller/notifications")
      return json({
        items: [
          {
            id: "fixture-notification",
            title: "Synthetic notification",
            message: "Synthetic provider text",
            isRead: false,
            createdAt: stamp,
          },
        ],
        nextCursor: null,
      });
    if (path === "/api/seller/actions" && r.method() === "GET")
      return json({ items: [] });
    if (path === "/api/seller/actions") {
      lastRequest = r.postDataJSON();
      counts.requests++;
      return json({
        operation: { status: "acknowledged" },
        message: "Eldorado accepted the request. No repeated action.",
      });
    }
    if (path === "/api/reports/download") {
      lastRequest = r.postDataJSON();
      counts.requests++;
      return route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: "Title,Amount\nSynthetic,1.00",
      });
    }
    if (path === "/api/offers")
      return json({
        items: [
          {
            id: "predefined:" + id,
            title: "Synthetic batch listing",
            state: "Active",
            price: 2,
            currency: "USD",
            quantity: 10,
          },
        ],
        nextCursor: null,
      });
    if (path === "/api/offers/batch/preview") {
      lastRequest = r.postDataJSON();
      counts.checks++;
      return json({
        valid: true,
        id: requestId,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        items: [
          {
            target: "predefined:" + id,
            title: "Synthetic batch listing",
            before: { price: 2, currency: "USD", quantity: 10 },
            change: {
              kind: "offer.price",
              body: { amount: lastRequest.change.amount, currency: "USD" },
            },
            floor: 1.5,
          },
        ],
        problems: [],
      });
    }
    if (path === `/api/offers/batch/${requestId}/request`) {
      lastRequest = r.postDataJSON();
      counts.requests++;
      return json({
        ids: [requestId],
        message: "Requests recorded. No marketplace write was sent.",
      });
    }
    if (path === "/api/pricing/policies") {
      if (r.method() === "POST") {
        lastPolicy = r.postDataJSON();
        policy = {
          ...lastPolicy,
          id: requestId,
          native_id: id,
          offer_id: "predefined:" + id,
          currency: "USD",
          version: id,
          created_by: "fixture-requester",
          approved_by: null,
          interval_seconds: lastPolicy.intervalSeconds,
          review_status:
            lastPolicy.mode === "automatic" ? "pending" : "not_required",
          next_run_at: stamp,
        };
        return json({ policy });
      }
      return json({ items: policy ? [policy] : [] });
    }
    if (path === "/api/pricing/history") return json({ items: [] });
    if (path === "/api/pricing/quotes")
      return json({
        quote: {
          id: requestId,
          policy_id: requestId,
          policy_version: id,
          requested_by: "fixture-requester",
          amount: 1.95,
          currency: "USD",
          proof: { complete: true, equivalentOffers: 1, pages: 1 },
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 120000).toISOString(),
        },
        noChange: false,
      });
    if (path === `/api/pricing/quotes/${requestId}/request`) {
      lastRequest = r.postDataJSON();
      counts.requests++;
      return json({ id: requestId }, 201);
    }
    if (path === "/api/automation/settings") {
      if (r.method() === "POST") lastAuthorization = r.postDataJSON();
      return json({
        settings: {
          pollEnabled: false,
          pollSeconds: 60,
          autoDeliveryEnabled: false,
          autoPricingEnabled: false,
        },
        runtime: {
          scheduler_configured: true,
          last_heartbeat_at: null,
          last_poll_at: null,
          last_error_code: null,
          backoff_until: null,
        },
        connection: {
          configured: true,
          verifiedOnThisServer: true,
          verifiedAt: stamp,
          verifiedOrigin: "https://rivox.example",
        },
      });
    }
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
    get policy() {
      return lastPolicy;
    },
    get authorization() {
      return lastAuthorization;
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
  const pricing = await fixture();
  await pricing.page.goto(
    `http://127.0.0.1:3197/offers/edit?id=predefined:${id}`,
  );
  await pricing.page
    .getByLabel("Minimum unit price", { exact: true })
    .fill("1.5");
  await pricing.page
    .getByLabel("Price difference below an equivalent competitor")
    .fill("0.05");
  await pricing.page
    .getByRole("button", { name: "Save pricing rule", exact: true })
    .click();
  await expect(
    pricing.page.getByText("simulation · not_required", { exact: true }),
  ).toBeVisible();
  assert.equal(pricing.policy.mode, "simulation");
  await pricing.page
    .getByRole("button", { name: "Simulate against the complete market" })
    .click();
  await expect(pricing.page.getByText("$1.95", { exact: true })).toBeVisible();
  assert.equal(pricing.counts.requests, 0);
  assert.equal(pricing.counts.executions, 0);
  checks.push(
    "persisted floor defaults to simulation and simulation sends no change",
  );
  await pricing.page
    .getByLabel("Pricing mode", { exact: true })
    .selectOption("manual");
  await pricing.page
    .getByRole("button", { name: "Save pricing rule", exact: true })
    .click();
  await expect(
    pricing.page.getByText("manual · not_required", { exact: true }),
  ).toBeVisible();
  await pricing.page
    .getByRole("button", { name: "Simulate against the complete market" })
    .click();
  await pricing.page
    .getByLabel("Reason for this quoted price")
    .fill("Reviewed exact comparable package and floor");
  await expect(
    pricing.page.getByRole("button", {
      name: "Request this quoted price",
    }),
  ).toBeDisabled();
  await pricing.page
    .getByLabel("I confirm this listing and the displayed simulated price.")
    .check();
  await pricing.page
    .getByRole("button", { name: "Request this quoted price" })
    .click();
  await expect.poll(() => pricing.counts.requests).toBe(1);
  assert.equal(pricing.request.confirm, true);
  assert.equal("amount" in pricing.request, false);
  assert.equal(pricing.counts.executions, 0);
  checks.push(
    "manual repricing requires confirmation and submits only a server-owned quote reference",
  );
  await pricing.page
    .getByLabel("Pricing mode", { exact: true })
    .selectOption("automatic");
  await expect(
    pricing.page.getByRole("button", {
      name: "Save pricing rule",
      exact: true,
    }),
  ).toBeDisabled();
  await pricing.page
    .getByLabel(
      "I explicitly request automatic repricing for this listing using this exact floor, difference and precision.",
    )
    .check();
  await pricing.page
    .getByRole("button", { name: "Save pricing rule", exact: true })
    .click();
  await expect(
    pricing.page.getByText("automatic · pending", { exact: true }),
  ).toBeVisible();
  assert.equal(pricing.policy.confirmAutomatic, true);
  assert.equal(pricing.counts.executions, 0);
  checks.push(
    "automatic policy requires explicit consent and awaits independent review",
  );
  assert.deepEqual(pricing.errors, []);
  await pricing.page.close();
  const automation = await fixture();
  await automation.page.goto("http://127.0.0.1:3197/automation");
  await automation.page
    .getByLabel("Allow independently approved automatic pricing rules")
    .check();
  await expect(
    automation.page.getByRole("button", {
      name: "Save workspace authorization",
    }),
  ).toBeDisabled();
  await automation.page
    .getByLabel(/I explicitly authorize the selected automatic modes/)
    .check();
  await automation.page
    .getByRole("button", { name: "Save workspace authorization" })
    .click();
  await expect
    .poll(() => automation.authorization?.autoPricingEnabled)
    .toBe(true);
  await expect(
    automation.page.getByText(/Workspace preferences saved/),
  ).toBeVisible();
  await automation.page
    .getByRole("button", { name: "Save workspace authorization" })
    .click();
  await expect
    .poll(() => automation.authorization?.autoPricingEnabled)
    .toBe(false);
  assert.equal(automation.authorization.autoDeliveryEnabled, false);
  assert.equal(automation.authorization.confirmAutomation, false);
  assert.equal(automation.counts.executions, 0);
  assert.deepEqual(automation.errors, []);
  await automation.page.close();
  checks.push(
    "workspace opt-in requires explicit consent and its stop switches remain saveable without consent",
  );
  const seller = await fixture();
  await seller.page.goto("http://127.0.0.1:3197/seller");
  await expect(
    seller.page.getByText("Synthetic notification", { exact: true }),
  ).toBeVisible();
  await seller.page
    .getByRole("button", { name: "Set offline", exact: true })
    .click();
  await seller.page
    .getByLabel("Reason for this Seller action")
    .fill("Reviewed the complete seller availability change");
  await seller.page
    .getByLabel("I confirm this exact Seller action and its account scope.")
    .check();
  await expect(
    seller.page.getByRole("button", {
      name: "Confirm Seller action",
      exact: true,
    }),
  ).toBeDisabled();
  await seller.page.getByLabel("Type OFFLINE to confirm").fill("OFFLINE");
  await seller.page
    .getByRole("button", { name: "Confirm Seller action", exact: true })
    .click();
  await expect.poll(() => seller.counts.requests).toBe(1);
  assert.deepEqual(seller.request.action, { kind: "seller.offline" });
  assert.equal(seller.request.confirm, true);
  assert.equal(seller.counts.executions, 0);
  assert.deepEqual(seller.errors, []);
  await seller.page.close();
  checks.push(
    "account-wide availability requires a typed target, reason and explicit confirmation",
  );
  const report = await fixture();
  await report.page.goto("http://127.0.0.1:3197/reports");
  await report.page.getByLabel("Report from date").fill("2026-11-01");
  await report.page.getByLabel("Report through date").fill("2026-11-13");
  const downloaded = report.page.waitForEvent("download");
  await report.page
    .getByRole("button", { name: "Download official report", exact: true })
    .click();
  const download = await downloaded;
  assert.match(download.suggestedFilename(), /^eldorado-sold-orders-.*\.csv$/);
  assert.equal(report.request.kind, "sold-orders");
  assert.equal(report.counts.requests, 1);
  assert.deepEqual(report.errors, []);
  await report.page.close();
  checks.push(
    "authorized official reports download as files without entering query caches",
  );
  const batch = await fixture();
  await batch.page.goto("http://127.0.0.1:3197/offers/batch");
  await batch.page.getByRole("checkbox").first().check();
  await batch.page
    .getByLabel("New unit price for selected listings")
    .fill("1.95");
  await batch.page
    .getByRole("button", { name: "Preview exact changes" })
    .click();
  await expect(
    batch.page.getByRole("heading", { name: "Exact proposal" }),
  ).toBeVisible();
  assert.equal(batch.counts.requests, 0);
  await batch.page
    .getByLabel("Reason for this batch")
    .fill("Reviewed every exact listing and price floor");
  await expect(
    batch.page.getByRole("button", {
      name: "Request independent review for this batch",
    }),
  ).toBeDisabled();
  await batch.page
    .getByLabel("I verified every listing and value in this exact proposal.")
    .check();
  await batch.page
    .getByRole("button", { name: "Request independent review for this batch" })
    .click();
  await expect.poll(() => batch.counts.requests).toBe(1);
  assert.equal(batch.counts.executions, 0);
  assert.equal(batch.request.confirm, true);
  assert.equal("amount" in batch.request, false);
  assert.deepEqual(batch.errors, []);
  await batch.page.close();
  checks.push(
    "batch preview sends no writes and confirmed review submits only a stored proposal reference",
  );
  console.log(JSON.stringify({ passed: true, checks, externalWrites: 0 }));
} finally {
  await browser.close();
  await server.close();
}
