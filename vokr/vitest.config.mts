import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        // Phase 1 baseline. Ratchet up per phase as real code accumulates —
        // see Vokr-Implementation-Plan.md §5 Phase 1, task 2.
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/lib/**/*.test.ts",
            "src/server/**/*.test.ts",
            "src/config/**/*.test.ts",
          ],
          // Integration tests need a live Postgres (docker-compose.yml)
          // and run only via `npm run test:integration` — never as part
          // of `npm run test` / `npm run verify`, which stay
          // dependency-free per Phase 1.
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx", "src/app/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: [
            "src/server/**/*.integration.test.ts",
            "prisma/**/*.integration.test.ts",
          ],
          setupFiles: ["./vitest.integration.setup.ts"],
        },
      },
    ],
  },
});
