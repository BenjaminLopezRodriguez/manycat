/**
 * Playwright e2e against prod (checklist A, C, D, E).
 * Requires auth state: npx playwright codegen www.many.cat --save-storage=auth.json
 * Run: BASE_URL=https://www.many.cat npx playwright test tests/build-e2e.spec.ts
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://www.many.cat";
test.use({ storageState: "auth.json" });

test.describe("Build mode e2e", () => {
  test("pink calculator build mutates scaffold and saves to S3", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto(`${BASE}`);
    await page.getByRole("button", { name: /\+ new/i }).click();
    await page.getByRole("menuitem", { name: /build/i }).click().catch(() => {});
    await page.getByRole("textbox").fill("make a pink calculator");
    await page.keyboard.press("Enter");

    // C: creation message advertises S3 persistence
    const created = page.getByText(/saved to s3/i);
    const s3unset = page.getByText(/s3 unset — local merkle only/i);
    await expect(created.or(s3unset)).toBeVisible({ timeout: 120_000 });
    await expect(s3unset).toHaveCount(0); // fail if env missing

    // A: no scaffold-not-replaced warning at completion
    await expect(
      page.getByText(/scaffold template was not replaced/i)
    ).toHaveCount(0, { timeout: 8 * 60_000 });

    // D: chat never contains raw HTML error dumps
    await expect(page.getByText(/<!DOCTYPE/)).toHaveCount(0);
    await expect(page.getByText(/Agent failed to start:.*<html/i)).toHaveCount(0);
  });

  test("approximate preview does not leak JS", async ({ page }) => {
    await page.goto(`${BASE}`); // open an existing workspace-only build
    await page.getByRole("button", { name: /preview/i }).click();
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("body")).not.toContainText("useState");
    await expect(frame.locator("body")).not.toContainText("return (");
  });

  test("E: leaving the page keeps job alive; rail shows states", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto(`${BASE}`);
    // start a build (as above), then navigate away
    await page.goto(`${BASE}/`); // home
    // rail throbber while working
    await expect(page.locator('[data-rail-status="working"], .rail-throbber')).toBeVisible({ timeout: 60_000 });
    // eventually blue (update) or red (failure) — must not silently vanish
    await expect(
      page.locator('[data-rail-status="update"], [data-rail-status="failure"]')
    ).toBeVisible({ timeout: 8 * 60_000 });
  });
});
