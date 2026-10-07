import { expect, test } from "@playwright/test";

test("account: change password and email, then delete the account", async ({ page, browser }) => {
  const email = `acct-${Date.now()}@example.com`;
  const first = "correct-horse-battery";
  const second = "a-brand-new-passphrase";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(first);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // A second browser session that must be signed out by the password change.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/login");
  await otherPage.getByLabel("Email").fill(email);
  await otherPage.getByLabel("Password").fill(first);
  await otherPage.getByRole("button", { name: "Log in" }).click();
  await expect(otherPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

  // wrong current password is explained, not a generic failure
  await page.locator("#current_password").fill("not-my-password");
  await page.getByLabel("New password", { exact: true }).fill(second);
  await page.getByLabel("Confirm new password").fill(second);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your current password is incorrect.")).toBeVisible();

  await page.locator("#current_password").fill(first);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/Other devices have been signed out/)).toBeVisible();

  await otherPage.goto("/dashboard");
  await expect(otherPage).toHaveURL(/\/login$/);
  await other.close();

  const newEmail = `moved-${Date.now()}@example.com`;
  await page.getByLabel("New email address").fill(newEmail);
  await page.locator("#email_password").fill(second);
  await page.getByRole("button", { name: "Update email" }).click();
  await expect(page.getByText("Email updated")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: newEmail })).toBeVisible();

  await page.getByRole("button", { name: "Delete my account…" }).click();
  const confirm = page.getByRole("button", { name: "Delete account", exact: true });
  await expect(confirm).toBeDisabled();
  await page.locator("#delete_password").fill(second);
  await confirm.click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(newEmail);
  await page.getByLabel("Password").fill(second);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});
