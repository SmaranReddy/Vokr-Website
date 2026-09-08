import { z } from "zod";

/**
 * The client-safe half of `src/lib/env.ts`, split into its own module
 * (Phase 3) so that browser-only code (e.g. `src/lib/supabase-browser.ts`)
 * can import `clientEnv` without pulling `env.ts`'s server schema —
 * including its variable *names*, e.g. `SUPABASE_SERVICE_ROLE_KEY` — into
 * the client bundle. Values never leaked (the server schema is only
 * parsed server-side), but a Phase 3 client component importing the
 * combined `env.ts` put the server schema's key list in `.next/static`,
 * breaking the zero-server-secret-names bundle check every phase since
 * Phase 1 has relied on. `env.ts` re-exports `clientEnv` from here so
 * every existing server-side import site is unaffected.
 */

const optionalUrl = z.union([z.literal(""), z.url()]).optional();
const optionalString = z.string().optional();

export const clientSchema = z.object({
  // No default here — the localhost fallback lives in `config/site.ts`,
  // deliberately, so it stays visible as the Phase 19 production gate
  // (see Vokr-Implementation-Plan.md §2.5).
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: optionalString,
});

export type ClientEnv = z.infer<typeof clientSchema>;

/** Every variable name declared in the client schema. */
export const CLIENT_KEYS = Object.keys(clientSchema.shape);

/**
 * Parses `source` against `schema`, restricted to the schema's own keys.
 * On failure, throws **one** Error whose message lists every invalid or
 * missing key — never fails one variable at a time. Exported so the
 * aggregation behaviour itself (not just this file's schema) is directly
 * unit-testable.
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

const client = parseEnvSection(clientSchema, process.env, "Client environment");

/**
 * Client-safe environment values. Available in both server and browser
 * contexts.
 */
export const clientEnv: Readonly<ClientEnv> = Object.freeze(client);
