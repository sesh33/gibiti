import { test, expect } from "@playwright/test";

test("primary navigation exposes current page and remains named on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const inbox = navigation.getByRole("link", {
    name: "Smart inbox",
    exact: true,
  });
  await expect(inbox).toHaveAttribute("aria-current", "page");
  await expect(
    navigation.getByRole("link", { name: "Order center", exact: true }),
  ).toBeVisible();
  await navigation
    .getByRole("link", { name: "Order center", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Order center", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Order center", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(inbox).not.toHaveAttribute("aria-current", "page");
});

test("command search has a named field and keyboard-dismissable dialog", async ({
  page,
}) => {
  await page.goto("/inbox");
  // Opening once through the control also waits for React hydration before testing the global shortcut.
  await page.getByRole("button", { name: "Open command search" }).click();
  await expect(
    page.getByRole("dialog", { name: "Jump to your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Jump to your workspace" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Search workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("operational alert trigger exposes its expanded state", async ({
  page,
}) => {
  await page.goto("/inbox");
  const trigger = page.getByRole("button", { name: "Operational alerts" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("region", { name: "Operational alerts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
