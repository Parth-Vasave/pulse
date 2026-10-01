import { defineConfig } from "@playwright/test";

// Runs against an already-running stack (`docker compose up` or the local dev processes).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 6 * 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
