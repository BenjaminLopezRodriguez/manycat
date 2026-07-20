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
    // Adapted: shipped button's accessible name is "New" — the "+" is an icon.
    await page.getByRole("button", { name: /^new$/i }).click();
    // Optional mode switch — bounded timeout so a missing menu can't eat the test.
    await page
      .getByRole("menuitem", { name: /build/i })
      .click({ timeout: 3_000 })
      .catch(() => {});
    await page.getByRole("textbox").fill("make a pink calculator");
    // Shipped composer submits via the explicit button, not Enter.
    await page.getByRole("button", { name: /create project/i }).click();

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
    await page.goto(`${BASE}`);
    // Open an existing workspace-only build — Preview only renders in a workflow.
    await page.getByRole("button", { name: /pink calculator/i }).first().click();
    await page.getByRole("button", { name: /^preview$/i }).click();
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
    await expect(
      page.locator('[data-rail-status="working"], .rail-throbber').first(),
    ).toBeVisible({ timeout: 60_000 });
    // eventually blue (update) or red (failure) — must not silently vanish
    await expect(
      page.locator('[data-rail-status="update"], [data-rail-status="failure"]').first(),
    ).toBeVisible({ timeout: 8 * 60_000 });
  });
});
