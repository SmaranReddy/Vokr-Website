# Phase 19 — CI/CD + Artifact Registry (Vokr-Implementation-Plan.md).
#
# Three stages: deps -> build -> runtime. Only `.next/standalone`,
# `.next/static` and `public` reach the final image — `output: "standalone"`
# (next.config.ts) is what keeps this under Artifact Registry's 0.5 GB
# free-tier quota, the tightest allowance in the stack (plan §3.3).
#
# node:22-alpine matches .nvmrc (22.12.0) and package.json's
# "engines.node" >=22.12.0.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time,
# so they must be supplied per environment as build args — never baked
# into the image from a committed default.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=$NEXT_PUBLIC_RAZORPAY_KEY_ID

# `prisma7.config.ts` resolves DATABASE_URL via `env("DATABASE_URL")` at
# config-load time (required for `prisma generate`, which needs no live
# connection). This is a syntactic placeholder only, confined to this
# build stage — it is never copied into the runtime image, and the real
# value is injected into the Cloud Run service from Secret Manager.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL

# Plan §2.5 / Phase 19 task 10: refuse to ship a production image with a
# missing or still-localhost canonical site URL — this is the gate that
# closes the "shipped a localhost canonical URL" trap.
RUN case "$NEXT_PUBLIC_SITE_URL" in \
      ""|*localhost*) \
        echo "ERROR: NEXT_PUBLIC_SITE_URL is missing or still localhost ('$NEXT_PUBLIC_SITE_URL')." >&2; \
        echo "Refusing to build a production image — see Vokr-Implementation-Plan.md Phase 19 task 10." >&2; \
        exit 1 ;; \
    esac

RUN npm run build

# A build arg that was never passed is silently harmless to the build and
# fatal at runtime: Next.js inlines NEXT_PUBLIC_* by rewriting static member
# expressions, so an empty value simply inlines nothing. The Phase 19 audit
# found exactly that shipped to production — an image built without
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, leaving
# `createSupabaseBrowserClient()` throwing in the browser while every
# server-rendered page kept working and hid it. Assert the inlining
# happened rather than trusting that the arg was supplied.
#
# Each check is skipped when its arg is empty, so the PR gate (which builds
# with only NEXT_PUBLIC_SITE_URL) is unaffected; `deploy.yml` requires all
# three to be non-empty before it ever reaches this stage.
RUN set -eu; \
    if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ]; then \
      host=$(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | sed -e 's|^[a-z]*://||' -e 's|/.*$||'); \
      grep -rqF "$host" .next/static || { \
        echo "ERROR: NEXT_PUBLIC_SUPABASE_URL was supplied but is absent from .next/static." >&2; \
        echo "The browser Supabase client would throw at runtime. Refusing to ship." >&2; \
        exit 1; \
      }; \
    fi; \
    if [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then \
      grep -rqF "$NEXT_PUBLIC_SUPABASE_ANON_KEY" .next/static || { \
        echo "ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY was supplied but is absent from .next/static." >&2; \
        exit 1; \
      }; \
    fi; \
    echo "OK: every supplied NEXT_PUBLIC_* value is inlined in the client bundle."

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
