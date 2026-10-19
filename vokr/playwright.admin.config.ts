import { defineConfig, devices } from "@playwright/test";

/**
 * The local admin browser test only (`e2e/admin/admin.spec.ts`). No
 * `webServer`: it targets a build you started against local Supabase.
 */
export default defineConfig({
  testDir: "./e2e/admin",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.ADMIN_E2E_BASE_URL ?? "http://localhost:3003",
    trace: "retain-on-failure",
  },
  outputDir: "./e2e/admin/.artifacts/results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
