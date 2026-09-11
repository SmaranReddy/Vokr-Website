import { z } from "zod";

import {
  CLIENT_KEYS,
  clientEnv,
  parseEnvSection,
  type ClientEnv,
} from "./env-client";

/**
 * Boot-time environment validation. Parsed once at module load; every
 * consumer imports the frozen `env` / `clientEnv` objects below instead of
 * touching `process.env` directly, so an invalid variable fails the
 * process at startup rather than mid-request.
 *
 * The client schema and `clientEnv` itself live in `./env-client` — a
 * separate module so browser-only code can depend on just that half
 * without pulling this file's server schema (including its variable
 * *names*) into a client bundle. Re-exported below so every existing
 * server-side `from "@/lib/env"` import site is unaffected.
 */

export { clientEnv, parseEnvSection, type ClientEnv };

const optionalString = z.string().optional();

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalString,
  DIRECT_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  BREVO_API_KEY: optionalString,
  SENTRY_DSN: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,

  // Phase 6 (Address + Checkout Foundation). Optional here for the same
  // reason `products.gst_rate_bps` is nullable (decision D2): an unset
  // value must fail loudly at the point of use, in
  // `src/server/checkout/crypto.ts` / `src/server/pricing/config.ts`,
  // never silently default.
  //
  // 32-byte AES-256-GCM key, base64-encoded (`openssl rand -base64 32`).
  ADDRESS_ENCRYPTION_KEY: optionalString,
  // The seller's registered GST state (must be one of
  // `src/lib/gst-states.ts`'s names) — blocked on decision D3 (legal
  // entity + GST registration). Do not set a placeholder value.
  CHECKOUT_SELLER_STATE: optionalString,
  // Flat shipping fee (paise) below the ₹4,999 free-shipping threshold,
  // and the COD handling fee (paise) — published nowhere yet as an exact
  // figure (terms.html and the cart/PDP copy state only the ₹4,999
  // threshold and that a COD fee applies, never an amount). Recorded as
  // decision D11, Vokr-Implementation-Plan.md §0.3.
  CHECKOUT_FLAT_SHIPPING_FEE_PAISE: optionalString,
  CHECKOUT_COD_HANDLING_FEE_PAISE: optionalString,
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Every variable name declared in the server schema. */
const SERVER_KEYS = Object.keys(serverSchema.shape);

/**
 * Throws if any name in `serverKeys` also appears, prefixed with
 * `NEXT_PUBLIC_`, in `clientKeys` — i.e. a server-only secret must never
 * be reachable through a public variable name.
 */
export function assertNoServerKeyLeak(
  serverKeys: readonly string[],
  clientKeys: readonly string[],
): void {
  const publicSet = new Set(clientKeys);
  for (const serverKey of serverKeys) {
    const asPublic = `NEXT_PUBLIC_${serverKey}`;
    if (publicSet.has(asPublic)) {
      throw new Error(
        `Server environment — variable "${serverKey}" is also declared as ` +
          `client variable "${asPublic}". A server-only secret must never ` +
          `be exposed under a NEXT_PUBLIC_ name.`,
      );
    }
  }
}

assertNoServerKeyLeak(SERVER_KEYS, CLIENT_KEYS);

const server =
  typeof window === "undefined"
    ? parseEnvSection(serverSchema, process.env, "Server environment")
    : undefined;

/**
 * Server-only environment values. Throws if called from a browser context
 * instead of silently returning a partial object.
 */
export function requireServerEnv(): Readonly<ServerEnv> {
  if (!server) {
    throw new Error(
      "requireServerEnv() was called in a browser context. Server " +
        "environment variables are never available to the client.",
    );
  }
  return server;
}

/** Convenience export for the common case: importing from server code. */
export const env: Readonly<ClientEnv & ServerEnv> = Object.freeze({
  ...clientEnv,
  ...(server ?? ({} as ServerEnv)),
});
