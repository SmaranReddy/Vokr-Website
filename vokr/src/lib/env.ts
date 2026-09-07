import { z } from "zod";

/**
 * Boot-time environment validation. Parsed once at module load; every
 * consumer imports the frozen `env` / `clientEnv` objects below instead of
 * touching `process.env` directly, so an invalid variable fails the
 * process at startup rather than mid-request.
 *
 * Split into `client` (must be prefixed NEXT_PUBLIC_ and safe for the
 * browser bundle) and `server` (never prefixed NEXT_PUBLIC_) so a secret
 * can never be promoted into the client schema by accident.
 */

const optionalUrl = z.union([z.literal(""), z.url()]).optional();
const optionalString = z.string().optional();

const clientSchema = z.object({
  // No default here — the localhost fallback lives in `config/site.ts`,
  // deliberately, so it stays visible as the Phase 19 production gate
  // (see Vokr-Implementation-Plan.md §2.5).
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: optionalString,
});

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
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/** Every variable name declared in the client schema. */
const CLIENT_KEYS = Object.keys(clientSchema.shape);

/** Every variable name declared in the server schema. */
const SERVER_KEYS = Object.keys(serverSchema.shape);

/**
 * Parses `source` against `schema`, restricted to the schema's own keys.
 * On failure, throws **one** Error whose message lists every invalid or
 * missing key — never fails one variable at a time. Exported so the
 * aggregation behaviour itself (not just this file's two concrete
 * schemas) is directly unit-testable.
 */
export function parseEnvSection<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<z.ZodObject<Shape>> {
  const keys = Object.keys(schema.shape);
  const raw: Record<string, string | undefined> = {};
  for (const key of keys) {
    raw[key] = source[key];
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(root)";
      return `  - ${key}: ${issue.message}`;
    });
    throw new Error(
      [`${label} — invalid environment configuration:`, ...lines].join("\n"),
    );
  }
  return result.data;
}

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

const client = parseEnvSection(clientSchema, process.env, "Client environment");
const server =
  typeof window === "undefined"
    ? parseEnvSection(serverSchema, process.env, "Server environment")
    : undefined;

/**
 * Client-safe environment values. Available in both server and browser
 * contexts.
 */
export const clientEnv: Readonly<ClientEnv> = Object.freeze(client);

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
  ...client,
  ...(server ?? ({} as ServerEnv)),
});
