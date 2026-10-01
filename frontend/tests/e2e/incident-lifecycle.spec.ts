import { expect, test } from "@playwright/test";

// Where the *monitoring workers* reach the demo service, vs. where this test reaches its control API.
const TARGET = process.env.E2E_TARGET_URL ?? "http://localhost:9000";
const CONTROL = process.env.E2E_CONTROL_URL ?? "http://localhost:9000";

test("register → monitor → failure → incident → recovery → resolved", async ({ page, request }) => {
  await request.post(`${CONTROL}/switch/restore`);
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("No monitors yet")).toBeVisible();

  await page.getByRole("link", { name: "Add monitor" }).first().click();
  await page.getByLabel("Name").fill("Demo switch");
  await page.getByLabel("URL").fill(`${TARGET}/switch`);
  await page.getByLabel("Check every (seconds)").fill("30");
  await page.getByLabel("Open an incident after").fill("2");
  await page.getByLabel("Resolve after").fill("1");
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("heading", { name: "Demo switch" })).toBeVisible();
  await expect(page.getByText("UP", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("✓ Passed").first()).toBeVisible({ timeout: 60_000 });

  await request.post(`${CONTROL}/switch/fail`);
  await expect(page.getByText("DOWN", { exact: true })).toBeVisible({ timeout: 150_000 });

  await page.getByRole("link", { name: "Incidents" }).click();
  await expect(page.getByRole("heading", { name: "Active" })).toBeVisible();
  await expect(page.getByText("✕ Ongoing")).toBeVisible();

  await request.post(`${CONTROL}/switch/restore`);
  await expect(page.getByText("No active incidents")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("link", { name: "Demo switch" }).click();
  await expect(page.getByText("Incident resolved")).toBeVisible();
  await expect(page.getByText("Incident created after 2 consecutive failures")).toBeVisible();
});
