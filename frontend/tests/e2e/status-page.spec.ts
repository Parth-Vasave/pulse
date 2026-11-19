import { expect, test } from "@playwright/test";

test("status page: publish for a visitor, then disable publishing", async ({ page, browser }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `status-${suffix}@example.com`;
  const slug = `status-${suffix}`;

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Status page/ }).click();
  await expect(page).toHaveURL(/\/settings\/status-page$/);
  await expect(page.getByRole("heading", { name: "Public status page" })).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Make the status page public" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Page address").fill(slug);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Status page saved.")).toBeVisible();

  const openLink = page.getByRole("link", { name: "Open status page" });
  await expect(openLink).toHaveAttribute("href", `/status/${slug}`);

  // Signed-out visitor context reaches the published URL without logging in.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`/status/${slug}`);
  await expect(visitorPage).toHaveURL(new RegExp(`/status/${slug}$`));
  await expect(visitorPage.getByRole("heading", { name: "Service status" })).toBeAttached();
  await expect(visitorPage.getByText("No services are listed yet.")).toBeVisible();
  await expect(visitorPage.getByText("No incidents in the last 14 days.")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(openLink).toBeHidden();

  await visitorPage.goto(`/status/${slug}`);
  await expect(visitorPage.getByText("This status page doesn’t exist or isn’t public.")).toBeVisible();
  await visitor.close();
});
