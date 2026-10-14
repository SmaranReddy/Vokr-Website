import { requireServerEnv } from "@/lib/env";

import type { MaintenanceReport } from "./maintenance";
import { verifyGoogleOidcToken, type KeyResolver, type OidcExpectation } from "./oidc";

export interface MaintenanceResponse {
  status: number;
  body: { ok: boolean; error?: string; report?: MaintenanceReport };
}

/** `undefined` unless both are set — the endpoint then refuses every call rather than accepting an unverifiable one. */
export function getMaintenanceOidcExpectation(): OidcExpectation | undefined {
  const { MAINTENANCE_OIDC_AUDIENCE, MAINTENANCE_OIDC_SERVICE_ACCOUNT } = requireServerEnv();
  if (!MAINTENANCE_OIDC_AUDIENCE || !MAINTENANCE_OIDC_SERVICE_ACCOUNT) return undefined;
  return { audience: MAINTENANCE_OIDC_AUDIENCE, serviceAccountEmail: MAINTENANCE_OIDC_SERVICE_ACCOUNT };
}

/**
 * `POST /api/jobs/maintenance` minus the framework: refuse without
 * configuration (503), refuse without a valid scheduler OIDC token (401,
 * one uniform answer whatever the reason), otherwise run the job. A step
 * failure is a 500 so Cloud Scheduler records the run as failed and
 * retries it — every step is safe to repeat.
 */
export async function handleMaintenanceRequest(input: {
  authorization: string | null;
  expected: OidcExpectation | undefined;
  resolveKey: KeyResolver;
  run: () => Promise<MaintenanceReport>;
}): Promise<MaintenanceResponse> {
  if (!input.expected) {
    console.error("[jobs/maintenance] refused: MAINTENANCE_OIDC_AUDIENCE / MAINTENANCE_OIDC_SERVICE_ACCOUNT not configured");
    return { status: 503, body: { ok: false, error: "not_configured" } };
  }

  const bearer = /^Bearer ([A-Za-z0-9._-]+)$/.exec(input.authorization ?? "")?.[1];
  const verdict = bearer
    ? await verifyGoogleOidcToken(bearer, input.expected, input.resolveKey)
    : ({ ok: false, reason: "missing" } as const);
  if (!verdict.ok) {
    console.warn(`[jobs/maintenance] refused: ${verdict.reason}`);
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }

  const report = await input.run();
  return { status: report.ok ? 200 : 500, body: { ok: report.ok, report } };
}
