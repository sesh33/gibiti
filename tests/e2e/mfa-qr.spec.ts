import { test, expect } from "@playwright/test";

// Synthetic drawing only: no real TOTP secret or enrollment URI is present.
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#fff"/><path fill="#000" d="M0 0h10v10H0z"/></svg>';

test("renders the installed Supabase SDK QR format as a loadable image", async ({
  page,
}) => {
  await page.route("**/api/auth/mfa", (route) =>
    route.fulfill({
      json: {
        factorId: "11111111-1111-4111-8111-111111111111",
        qrCode: `data:image/svg+xml;utf-8,${svg}`,
      },
    }),
  );
  await page.goto("/mfa");
  await page
    .getByRole("button", { name: "Set up or verify authenticator" })
    .click();
  const image = page.getByRole("img", {
    name: "Authenticator enrollment QR code",
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => ({
        loaded: (element as HTMLImageElement).complete,
        width: (element as HTMLImageElement).naturalWidth,
      })),
    )
    .toEqual({ loaded: true, width: 20 });
  await expect(
    page.getByRole("textbox", { name: "Six-digit verification code" }),
  ).toBeVisible();
});

test("an invalid QR response leaves enrollment retryable", async ({ page }) => {
  await page.route("**/api/auth/mfa", (route) =>
    route.fulfill({
      json: {
        factorId: "11111111-1111-4111-8111-111111111111",
        qrCode: "https://example.test/unexpected-image.svg",
      },
    }),
  );
  await page.goto("/mfa");
  await page
    .getByRole("button", { name: "Set up or verify authenticator" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "QR code could not be displayed" }),
  ).toContainText("QR code could not be displayed");
  await expect(
    page.getByRole("textbox", { name: "Six-digit verification code" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set up or verify authenticator" }),
  ).toBeEnabled();
});
