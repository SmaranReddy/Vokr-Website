import { defineConfig, devices } from "@playwright/test";

/**
 * Scaffolding only — Phase 1 adds no e2e tests. Real specs land in
 * Phases 4, 5, 6, 7, 9, 21 and 23 (see Vokr-Implementation-Plan.md §7.1),
 * against a real running app rather than mocked network calls.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
