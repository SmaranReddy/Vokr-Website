# Dependency audit

Plan §5 Phase 16, task 9. CI (`.github/workflows/ci.yml`) runs:

- `npm audit --omit=dev --audit-level=high`, which **gates** the build. A high or
  critical advisory in anything that ships fails it.
- `npm audit --audit-level=high` across all dependencies, which is **report
  only**. Dev tooling never reaches the runtime image, because the standalone
  build traces only runtime files.

## 16 Oct 2026 remediation

| Package | Was | Now | Advisories closed (production) |
|---|---|---|---|
| `next` (+ `eslint-config-next`) | 16.3.4 | 16.4.2 | Critical RCE in `next/og` ImageResponse (not used here); SSG/ISR cache poisoning in self-hosted apps (**applies**: self-hosted, PDP uses ISR); SSRF in image optimisation (**applies**: `next/image` is used); metadata-image and dev-server information disclosure; Draft Mode leak through `use cache` |
| `sharp` (via next) | <0.35.5 | patched | librsvg CVE |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.0 | 7.10.1 | `deepmerge-ts` stack exhaustion (via `@prisma/config`); `mysql2` advisories (unused driver, transitive) |
| `source-map-js`, `fast-uri` | vulnerable | patched (`npm audit fix`) | DoS; host normalisation |

Result: **0 vulnerabilities in production dependencies.**

## Accepted (dev only, no fix exists)

`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` →
`eslint-config-next`. The advisory covers every published `braces` version.
npm's only suggestion is to downgrade to `eslint-config-next@14`, which is not a
fix. This is lint tooling only and is not in the image. Re-check when a fixed
`braces` is published.
