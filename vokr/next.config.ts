import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle in `.next/standalone`.
   *
   * The production target is a container on Cloud Run pushed through
   * Artifact Registry, whose free tier is 0.5 GB — the tightest quota in
   * the whole stack (PDF §4). A conventional Next.js image is 150–400 MB,
   * so two or three retained revisions breach it. Standalone output ships
   * only the traced runtime files, which is what keeps the R2 cleanup
   * policy (keep 2 tags, delete untagged) sufficient.
   */
  output: "standalone",

  /** Don't advertise the framework and its version to every client. */
  poweredByHeader: false,

  /** Security headers on every response (plan §5 Phase 16, task 1) — see `src/config/security-headers.ts`. */
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
