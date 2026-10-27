import { test, expect } from "@playwright/test";
test("honest disconnected inbox and keyboard navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/inbox");
  await expect(
    page.getByRole("heading", { name: "Smart inbox" }),
  ).toBeVisible();
  await expect(
    page.getByText("Awaiting official messaging access", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message reply" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send reply" })).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Search conversations" })
    .fill("not-a-real-buyer");
  await expect(page.getByText("No matching conversations")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByPlaceholder("Search pages, buyers, or products...")
    .fill("Inventory");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Inventory", exact: true })
    .click();
  await expect(page).toHaveURL(/inventory/);
  await expect(
    page.getByRole("heading", { name: "Inventory, under control." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("all operational modules render with zero invented account data", async ({
  page,
}) => {
  for (const [route, title] of [
    ["/overview", "A clearer view of your operation."],
    ["/orders", "Order center"],
    ["/offers", "Offers, without the clutter."],
    ["/team", "Your team. Your rules."],
    ["/approvals", "A deliberate second look."],
    ["/activity", "Every action leaves a record."],
    ["/settings", "Connected carefully. Controlled completely."],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Secure setup required. No live account data is being displayed.",
      ),
    ).toBeVisible();
  }
  await expect(
    page.getByText("ELDORADO_CLIENT_SECRET", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SUPABASE_SERVICE_ROLE_KEY", { exact: true }),
  ).toBeVisible();
});
test("protected routes fail closed and cross-origin writes are rejected", async ({
  request,
}) => {
  const read = await request.get("/api/orders");
  expect(read.status()).toBe(503);
  expect((await read.json()).error.code).toBe("SETUP_REQUIRED");
  const write = await request.post("/api/orders/sync", {
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    data: {},
  });
  expect(write.status()).toBe(403);
  expect((await write.json()).error.code).toBe("INVALID_ORIGIN");
});
test("responsive workspace has no horizontal page overflow", async ({
  page,
}) => {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { name: "Smart inbox" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `overflow at ${width}`,
    ).toBe(true);
  }
});
test("sign-in reports missing auth configuration without accepting secrets", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByText("Authentication is not configured."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Work email" })).toHaveCount(
    0,
  );
});
