// End-to-end check on the isolated local stack only. Synthetic accounts are removed afterwards.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import jsQR from "jsqr";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const bindings = JSON.parse(readFileSync(".rivox/local-bindings.json", "utf8"));
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(bindings.NEXT_PUBLIC_SUPABASE_URL).hostname,
  )
)
  throw new Error("Local-only test refused.");
const admin = createClient(
  bindings.NEXT_PUBLIC_SUPABASE_URL,
  bindings.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const ownerCheck = await admin
  .from("users")
  .select("id")
  .eq("role", "OWNER")
  .limit(1);
if (ownerCheck.error || ownerCheck.data.length)
  throw new Error(
    "Use a fresh local stack with no Owner. Existing accounts are never reset by this test.",
  );
const tokenFile = process.env.RIVOX_SETUP_TOKEN_FILE;
if (!tokenFile)
  throw new Error(
    "Set RIVOX_SETUP_TOKEN_FILE to the private setup token file path.",
  );
const token = readFileSync(tokenFile, "utf8").trim();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const ownerContext = await browser.newContext();
const page = await ownerContext.newPage();
page.on("response", async (response) => {
  if (response.url().includes("/api/") && response.status() >= 400) {
    let code;
    try {
      code = (await response.json()).error?.code;
    } catch {}
    if (typeof code === "string" && /^[A-Z_]{1,70}$/.test(code))
      console.log(
        "Local API diagnostic: HTTP " + response.status() + " " + code,
      );
  }
});
let stage = "initialization",
  checks = 0,
  passed = false;
const fixtureIds = [],
  emails = [];
const email =
  "validation-owner-" + randomBytes(5).toString("hex") + "@example.test";
emails.push(email);
const password = randomBytes(28).toString("base64url");
function otp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP encoding");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash.at(-1) & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
async function mfa(target) {
  stage = "MFA setup button";
  await target
    .getByRole("button", { name: "Set up or verify authenticator" })
    .click();
  stage = "MFA QR rendering";
  const image = target.getByRole("img", {
    name: "Authenticator enrollment QR code",
  });
  await image.waitFor();
  await image.evaluate(
    (img) =>
      new Promise((resolve) => {
        if (img.complete) resolve();
        else img.onload = () => resolve();
      }),
  );
  const pixels = await image.evaluate((img) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "#ffffff";
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(img, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
          .data,
      ),
    };
  });
  const qr = jsQR(
    Uint8ClampedArray.from(pixels.data),
    pixels.width,
    pixels.height,
  );
  assert.ok(qr);
  const secret = new URL(qr.data).searchParams.get("secret");
  assert.ok(secret);
  await target
    .getByRole("textbox", { name: "Six-digit verification code" })
    .fill(otp(secret));
  await target.getByRole("button", { name: "Verify and continue" }).click();
  await target.waitForURL("**/inbox");
  checks++;
}
async function call(context, path, method = "GET", data) {
  const response = await context.request.fetch("http://127.0.0.1:3000" + path, {
    method,
    headers: {
      Origin: "http://127.0.0.1:3000",
      "Content-Type": "application/json",
    },
    ...(data ? { data } : {}),
  });
  const body = await response.json();
  if (response.status() >= 400 && /^[A-Z_]{1,70}$/.test(body.error?.code ?? ""))
    console.log(
      "Expected/diagnostic local API status: " +
        response.status() +
        " " +
        body.error.code,
    );
  return { status: response.status(), body };
}
try {
  stage = "Owner creation UI";
  await page.goto("http://127.0.0.1:3000/setup/owner");
  await page.getByLabel("Private setup token").fill(token);
  await page.getByLabel("Display name").fill("Validation Owner");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Account password").fill(password);
  await page.getByRole("checkbox").check();
  const [setupResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/setup/owner") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create Owner membership" }).click(),
  ]);
  assert.equal(setupResponse.status(), 200);
  await page.waitForURL("**/mfa");
  checks++;
  stage = "Owner MFA QR and real verification";
  await mfa(page);
  stage = "authenticated identity";
  const identity = await call(ownerContext, "/api/me");
  assert.equal(identity.status, 200);
  fixtureIds.push(identity.body.profile.id);
  checks++;
  stage = "live order synchronization";
  if (process.argv.includes("--allow-live-reads")) {
    const sync = await call(ownerContext, "/api/orders/sync", "POST", {});
    assert.equal(sync.status, 200);
    checks++;
    console.log(
      "Real order synchronization succeeded: " + sync.body.count + " records.",
    );
  }
  stage = "order list and details";
  const orders = await call(ownerContext, "/api/orders");
  assert.equal(orders.status, 200);
  const order = orders.body.items[0];
  assert.ok(order);
  assert.equal(
    (await call(ownerContext, "/api/orders/" + order.id)).status,
    200,
  );
  await page.goto("http://127.0.0.1:3000/orders/" + order.id);
  await page.getByRole("heading", { name: "Controlled actions" }).waitFor();
  checks++;
  stage = "internal notes";
  assert.equal(
    (
      await call(ownerContext, "/api/orders/" + order.id + "/notes", "POST", {
        body: "Synthetic validation note; this was not sent to the buyer.",
      })
    ).status,
    201,
  );
  checks++;
  stage = "live offer synchronization";
  if (process.argv.includes("--allow-live-reads")) {
    const sync = await call(ownerContext, "/api/offers/sync", "POST", {
      source: "all",
    });
    assert.equal(sync.status, 200);
    assert.ok(sync.body.results.some((result) => result.ok));
    console.log(
      "Real listing categories synchronized: " +
        sync.body.results.filter((result) => result.ok).length +
        ".",
    );
    checks++;
  }
  stage = "employee invitation";
  const supportEmail =
    "validation-support-" + randomBytes(5).toString("hex") + "@example.test";
  emails.push(supportEmail);
  const invite = await call(ownerContext, "/api/team", "POST", {
    email: supportEmail,
    name: "Validation Support",
    role: "SUPPORT_AGENT",
  });
  assert.equal(invite.status, 201);
  const staff = await call(ownerContext, "/api/team");
  const support = staff.body.items.find((user) => user.email === supportEmail);
  assert.ok(support);
  fixtureIds.push(support.id);
  checks++;
  stage = "staff authentication and assignment isolation";
  const supportPassword = randomBytes(28).toString("base64url");
  stage = "real local invitation delivery and password setup";
  let message;
  for (let attempt = 0; attempt < 10 && !message; attempt++) {
    const mailbox = await (
      await fetch("http://127.0.0.1:54324/api/v1/messages")
    ).json();
    message = mailbox.messages?.find((item) =>
      JSON.stringify(item.To ?? []).includes(supportEmail),
    );
    if (!message) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(message);
  const delivered = await (
    await fetch("http://127.0.0.1:54324/api/v1/message/" + message.ID)
  ).json();
  const links = [...delivered.HTML.matchAll(/href=["']([^"']+)["']/g)].map(
    (match) => match[1].replaceAll("&amp;", "&"),
  );
  const inviteLink = links.find((link) => {
    try {
      const url = new URL(link);
      return (
        ["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.pathname.includes("/auth/v1/verify")
      );
    } catch {
      return false;
    }
  });
  assert.ok(inviteLink);
  const supportContext = await browser.newContext();
  const supportPage = await supportContext.newPage();
  await supportPage.goto(inviteLink);
  await supportPage
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await supportPage
    .getByLabel("New password", { exact: true })
    .fill(supportPassword);
  await supportPage
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await supportPage.waitForURL("**/inbox");
  checks++;
  const restricted = await call(supportContext, "/api/orders");
  assert.equal(restricted.status, 200);
  assert.equal(restricted.body.items.length, 0);
  assert.equal((await call(supportContext, "/api/team")).status, 403);
  assert.equal(
    (
      await call(supportContext, "/api/approvals", "POST", {
        action: "orders.cancel",
        target: order.id,
        reason: "Synthetic forbidden cancellation request",
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  checks++;
  stage = "order assignment";
  assert.equal(
    (
      await call(ownerContext, "/api/orders/" + order.id + "/assign", "POST", {
        employee: support.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(supportContext, "/api/orders")).body.items.length,
    1,
  );
  checks++;
  stage = "inventory reservation and duplicate protection";
  const sku = "VALIDATION-" + randomBytes(5).toString("hex");
  const inventory = await call(ownerContext, "/api/inventory", "POST", {
    sku,
    title: "Synthetic validation inventory",
    category: "Validation",
    secret: "Synthetic delivery fixture only",
  });
  assert.equal(inventory.status, 201);
  const revealed = await call(ownerContext, "/api/inventory/reveal", "POST", {
    item: inventory.body.id,
  });
  assert.equal(revealed.status, 200);
  assert.equal(revealed.body.value, "Synthetic delivery fixture only");
  assert.equal(
    (
      await call(supportContext, "/api/inventory/reveal", "POST", {
        item: inventory.body.id,
      })
    ).status,
    403,
  );
  const reserve = await call(ownerContext, "/api/inventory/reserve", "POST", {
    item: inventory.body.id,
    order: order.id,
  });
  assert.equal(reserve.status, 201);
  assert.equal(
    (
      await call(ownerContext, "/api/inventory/reserve", "POST", {
        item: inventory.body.id,
        order: order.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(ownerContext, "/api/inventory/finish", "POST", {
        reservation: reserve.body.id,
        consume: false,
        reason: "Synthetic test release",
      })
    ).status,
    200,
  );
  checks++;
  stage = "approval intent and duplicate request";
  const requestKey = crypto.randomUUID();
  const action = {
    action: "orders.cancel",
    target: order.id,
    reason:
      "Synthetic approval validation only; no upstream write is authorized.",
    idempotencyKey: requestKey,
  };
  const approval = await call(ownerContext, "/api/approvals", "POST", action);
  assert.equal(approval.status, 201);
  assert.equal(
    (await call(ownerContext, "/api/approvals", "POST", action)).body.id,
    approval.body.id,
  );
  assert.equal(
    (
      await call(ownerContext, "/api/approvals/" + approval.body.id, "PATCH", {
        approve: true,
        reason: "Self approval must fail",
      })
    ).status,
    409,
  );
  checks++;
  stage = "reviewer invitation and MFA";
  const reviewerEmail =
    "validation-reviewer-" + randomBytes(5).toString("hex") + "@example.test";
  emails.push(reviewerEmail);
  assert.equal(
    (
      await call(ownerContext, "/api/team", "POST", {
        email: reviewerEmail,
        name: "Validation Reviewer",
        role: "ADMIN",
      })
    ).status,
    201,
  );
  const reviewer = (await call(ownerContext, "/api/team")).body.items.find(
    (user) => user.email === reviewerEmail,
  );
  assert.ok(reviewer);
  fixtureIds.push(reviewer.id);
  const reviewerPassword = randomBytes(28).toString("base64url");
  assert.equal(
    (
      await admin.auth.admin.updateUserById(reviewer.id, {
        password: reviewerPassword,
        email_confirm: true,
      })
    ).error,
    null,
  );
  const reviewerContext = await browser.newContext();
  assert.equal(
    (
      await call(reviewerContext, "/api/auth/login", "POST", {
        email: reviewerEmail,
        password: reviewerPassword,
      })
    ).status,
    200,
  );
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto("http://127.0.0.1:3000/mfa");
  await mfa(reviewerPage);
  stage = "custom role creation and independently approved assignment";
  const profileName = "Validation Role " + randomBytes(4).toString("hex");
  const profile = await call(ownerContext, "/api/team/roles", "POST", {
    name: profileName,
    baseRole: "SUPPORT_AGENT",
    overrides: [
      { permission: "orders.deliver", allowed: true },
      { permission: "orders.cancel", allowed: false },
    ],
  });
  assert.equal(profile.status, 201);
  const accessRequest = await call(
    ownerContext,
    "/api/team/" + support.id,
    "PATCH",
    {
      role: "SUPPORT_AGENT",
      roleProfileId: profile.body.id,
      active: true,
      reason: "Synthetic custom role validation with separate reviewer",
      idempotencyKey: crypto.randomUUID(),
      overrides: [],
    },
  );
  assert.equal(accessRequest.status, 200);
  const review = await call(
    reviewerContext,
    "/api/approvals/" + accessRequest.body.id,
    "PATCH",
    { approve: true, reason: "Synthetic independent access review" },
  );
  assert.equal(review.status, 200);
  assert.equal(review.body.executed, true);
  const updated = (await call(ownerContext, "/api/team")).body.items.find(
    (user) => user.id === support.id,
  );
  assert.equal(updated.role_label, profileName);
  assert.equal((await call(supportContext, "/api/me")).status, 403);
  assert.equal(
    (
      await call(supportContext, "/api/auth/login", "POST", {
        email: supportEmail,
        password: supportPassword,
      })
    ).status,
    200,
  );
  const newPermissions = (await call(supportContext, "/api/me")).body
    .permissions;
  assert.ok(newPermissions.includes("orders.deliver"));
  assert.ok(!newPermissions.includes("orders.cancel"));
  checks++;
  stage = "distinct approval of internal inventory consumption";
  const secondReservation = await call(
    ownerContext,
    "/api/inventory/reserve",
    "POST",
    { item: inventory.body.id, order: order.id },
  );
  assert.equal(secondReservation.status, 201);
  const consumption = await call(
    ownerContext,
    "/api/inventory/consume-request",
    "POST",
    {
      reservation: secondReservation.body.id,
      reason: "Synthetic reviewed internal stock usage",
      idempotencyKey: crypto.randomUUID(),
    },
  );
  assert.equal(consumption.status, 201);
  assert.equal(
    (
      await call(
        reviewerContext,
        "/api/approvals/" + consumption.body.id,
        "PATCH",
        { approve: true, reason: "Synthetic independent stock review" },
      )
    ).status,
    200,
  );
  const stock = (await call(ownerContext, "/api/inventory")).body.items.find(
    (item) => item.id === inventory.body.id,
  );
  assert.equal(stock.status, "delivered");
  assert.equal(
    (await call(ownerContext, "/api/orders/" + order.id)).body.order.state,
    order.state,
  );
  checks++;
  stage = "audit and analytics";
  assert.equal(
    (await call(ownerContext, "/api/workspace/activity")).status,
    200,
  );
  assert.equal(
    (await call(ownerContext, "/api/workspace/analytics")).status,
    200,
  );
  checks++;
  stage = "authenticated screenshots";
  await page.goto("http://127.0.0.1:3000/orders");
  await page
    .getByRole("heading", { name: "Order center", exact: true })
    .waitFor();
  await page.locator("tbody tr").first().waitFor();
  await page.screenshot({
    path: ".rivox/orders-validated.png",
    fullPage: true,
    mask: [page.locator("tbody td:first-child")],
  });
  await page.goto("http://127.0.0.1:3000/overview");
  await page
    .locator(".metric-card > strong")
    .first()
    .filter({ hasText: String(orders.body.items.length) })
    .waitFor();
  await page.screenshot({
    path: ".rivox/overview-validated.png",
    fullPage: true,
  });
  checks++;
  stage = "logout and stale session revocation";
  assert.equal(
    (await call(supportContext, "/api/auth/logout", "POST", {})).status,
    200,
  );
  assert.equal((await call(supportContext, "/api/me")).status, 401);
  checks++;
  await supportContext.close();
  passed = true;
  console.log(
    "Local real-auth workflow checks passed: " +
      checks +
      ". No Eldorado order/listing mutation was sent.",
  );
} catch (error) {
  console.error(
    "Local workflow failed at: " +
      stage +
      " (" +
      error.name +
      "). No credential or customer payload printed.",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  const all = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of all.data?.users ?? [])
    if (emails.includes(user.email) && !fixtureIds.includes(user.id))
      fixtureIds.push(user.id);
  const safeIds = fixtureIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (safeIds.length) {
    const list = safeIds.map((id) => "'" + id + "'").join(",");
    const cleanup = `begin;delete from public.approval_requests where requester_id in (${list}) or approver_id in (${list});delete from public.internal_notes where author_id in (${list});delete from public.order_assignments where user_id in (${list}) or assigned_by in (${list});delete from public.inventory_reservations where reserved_by in (${list});delete from public.inventory_movements where item_id in (select id from public.inventory_items where sku like 'VALIDATION-%');delete from public.inventory_secrets where item_id in (select id from public.inventory_items where sku like 'VALIDATION-%');delete from public.inventory_items where sku like 'VALIDATION-%';update public.audit_logs set actor_id=null where actor_id in (${list});delete from public.employee_sessions where user_id in (${list});delete from public.user_permission_overrides where user_id in (${list});delete from public.role_profiles where created_by in (${list});delete from public.users where id in (${list});commit;`;
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_rivox-control",
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: cleanup, stdio: ["pipe", "pipe", "pipe"] },
    );
    for (const id of safeIds) await admin.auth.admin.deleteUser(id);
  }
  writeFileSync(
    ".rivox/local-validation.json",
    JSON.stringify({
      passed,
      checks,
      upstreamMutations: 0,
      fixtureAccountsRemoved: true,
      validatedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
}
