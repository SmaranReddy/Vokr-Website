/**
 * Cloud Scheduler job 3 (plan §5 Phase 8, task 7): the configuration that
 * links the scheduler job to `POST /api/jobs/maintenance`, kept in one
 * place so the two halves cannot drift.
 *
 * The endpoint verifies a Google-signed OIDC token whose `aud` must equal
 * `MAINTENANCE_OIDC_AUDIENCE` exactly and whose `email` must equal
 * `MAINTENANCE_OIDC_SERVICE_ACCOUNT` (src/server/jobs/oidc.ts). If the
 * job's audience and the service's env differ by one character, every run
 * is a 401 forever. So:
 *
 *   - `validateMaintenanceConfig` is run by `deploy.yml` before any
 *     revision is created, against the repository variables;
 *   - `planSchedulerJob` and `revisionEnvProblems` are run by the operator
 *     script `scripts/maintenance-scheduler.ts`, which refuses to create or
 *     update the job unless every serving revision already carries the same
 *     values.
 *
 * Pure functions only; the gcloud calls live in the script.
 */

export const MAINTENANCE_PATH = "/api/jobs/maintenance";
export const MAINTENANCE_JOB_ID = "vokr-maintenance";

/**
 * Every 5 minutes. `retryCount` 1 with a short backoff retries a failed
 * run (the endpoint answers 500 when a step fails) well before the next
 * tick. `attemptDeadline` stays under Cloudflare's 100 s proxy timeout, so a
 * slow run is not cut off at the edge with a 524 and then retried while it
 * is still running. Overlap is safe anyway — every step is idempotent and
 * overlapping expiry runs are integration-tested — but should not be the
 * normal case.
 */
export const MAINTENANCE_JOB_SETTINGS = {
  schedule: "*/5 * * * *",
  timeZone: "Asia/Kolkata",
  httpMethod: "POST",
  attemptDeadline: "90s",
  retryCount: 1,
  minBackoffDuration: "30s",
  maxBackoffDuration: "60s",
  description:
    "Phase 8 job 3: reconcile payments, expire stock holds, prune rows. OIDC-authenticated in-app; see docs/infrastructure/cloud-run.md.",
} as const;

export interface MaintenanceConfig {
  siteUrl: string | undefined;
  projectId: string | undefined;
  audience: string | undefined;
  serviceAccount: string | undefined;
}

/** `https://vokr.shop` → `https://vokr.shop/api/jobs/maintenance`. `null` unless the site URL is a bare https origin. */
export function expectedAudience(siteUrl: string | undefined): string | null {
  if (!siteUrl) return null;
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return `${url.origin}${MAINTENANCE_PATH}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A user-managed service account of this project — not a default compute or Google-managed one. */
export function isProjectServiceAccount(email: string, projectId: string): boolean {
  return new RegExp(`^[a-z][a-z0-9-]{4,28}[a-z0-9]@${escapeRegExp(projectId)}\\.iam\\.gserviceaccount\\.com$`).test(email);
}

/** Empty when the audience and service account are exactly what the scheduler job will present. */
export function validateMaintenanceConfig(config: MaintenanceConfig): string[] {
  const problems: string[] = [];
  const audience = expectedAudience(config.siteUrl);
  if (!audience) {
    problems.push(`NEXT_PUBLIC_SITE_URL must be a bare https origin (got ${JSON.stringify(config.siteUrl ?? "")}).`);
  }
  if (!config.audience) {
    problems.push("MAINTENANCE_OIDC_AUDIENCE is not set.");
  } else if (audience && config.audience !== audience) {
    problems.push(`MAINTENANCE_OIDC_AUDIENCE must be exactly ${audience} (got ${JSON.stringify(config.audience)}).`);
  }
  if (!config.projectId) {
    problems.push("GCP_PROJECT_ID is not set.");
  }
  if (!config.serviceAccount) {
    problems.push("MAINTENANCE_OIDC_SERVICE_ACCOUNT is not set.");
  } else if (config.projectId && !isProjectServiceAccount(config.serviceAccount, config.projectId)) {
    problems.push(
      `MAINTENANCE_OIDC_SERVICE_ACCOUNT must be a service account of project ${config.projectId} (got ${JSON.stringify(config.serviceAccount)}).`,
    );
  }
  return problems;
}

/** The subset of `gcloud scheduler jobs describe --format=json` this module reads. */
export interface SchedulerJob {
  name: string;
  schedule?: string;
  timeZone?: string;
  state?: string;
  attemptDeadline?: string;
  description?: string;
  retryConfig?: { retryCount?: number; minBackoffDuration?: string; maxBackoffDuration?: string };
  httpTarget?: {
    uri?: string;
    httpMethod?: string;
    oidcToken?: { audience?: string; serviceAccountEmail?: string };
  };
}

export interface DesiredJob {
  id: string;
  uri: string;
  audience: string;
  serviceAccountEmail: string;
}

export function desiredJob(audience: string, serviceAccountEmail: string): DesiredJob {
  return { id: MAINTENANCE_JOB_ID, uri: audience, audience, serviceAccountEmail };
}

export type JobPlan =
  | { action: "create"; warnings: string[] }
  | { action: "update"; drift: string[]; warnings: string[] }
  | { action: "none"; warnings: string[] }
  | { action: "refuse"; reasons: string[] };

function jobId(job: SchedulerJob): string {
  return job.name.split("/").pop() ?? job.name;
}

/** What the job's fields would have to change from, field by field. */
export function jobDrift(job: SchedulerJob, desired: DesiredJob): string[] {
  const s = MAINTENANCE_JOB_SETTINGS;
  const checks: Array<[string, unknown, unknown]> = [
    ["schedule", job.schedule, s.schedule],
    ["timeZone", job.timeZone, s.timeZone],
    ["httpTarget.uri", job.httpTarget?.uri, desired.uri],
    ["httpTarget.httpMethod", job.httpTarget?.httpMethod, s.httpMethod],
    ["oidcToken.audience", job.httpTarget?.oidcToken?.audience, desired.audience],
    ["oidcToken.serviceAccountEmail", job.httpTarget?.oidcToken?.serviceAccountEmail, desired.serviceAccountEmail],
    ["attemptDeadline", job.attemptDeadline, s.attemptDeadline],
    ["retryConfig.retryCount", job.retryConfig?.retryCount ?? 0, s.retryCount],
    ["retryConfig.minBackoffDuration", job.retryConfig?.minBackoffDuration, s.minBackoffDuration],
    ["retryConfig.maxBackoffDuration", job.retryConfig?.maxBackoffDuration, s.maxBackoffDuration],
    ["description", job.description, s.description],
  ];
  return checks
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(([field, actual, wanted]) => `${field}: ${JSON.stringify(actual ?? null)} -> ${JSON.stringify(wanted)}`);
}

/**
 * Create, update or leave the job — or refuse when another job already
 * calls the same endpoint, which would run maintenance twice per tick
 * under two names. A paused job is reported, never resumed: pausing is a
 * deliberate operator act.
 */
export function planSchedulerJob(existing: SchedulerJob[], desired: DesiredJob): JobPlan {
  const duplicates = existing.filter((job) => jobId(job) !== desired.id && job.httpTarget?.uri === desired.uri);
  if (duplicates.length > 0) {
    return {
      action: "refuse",
      reasons: duplicates.map((job) => `job ${jobId(job)} already targets ${desired.uri}; remove it or adopt its name first.`),
    };
  }
  const current = existing.find((job) => jobId(job) === desired.id);
  if (!current) return { action: "create", warnings: [] };
  const warnings = current.state && current.state !== "ENABLED" ? [`job ${desired.id} is ${current.state}; it is left that way.`] : [];
  const drift = jobDrift(current, desired);
  return drift.length > 0 ? { action: "update", drift, warnings } : { action: "none", warnings };
}

/** The `gcloud scheduler jobs create|update http` arguments for the desired job. */
export function schedulerJobArgs(
  verb: "create" | "update",
  desired: DesiredJob,
  target: { projectId: string; region: string },
): string[] {
  const s = MAINTENANCE_JOB_SETTINGS;
  return [
    "scheduler",
    "jobs",
    verb,
    "http",
    desired.id,
    `--project=${target.projectId}`,
    `--location=${target.region}`,
    `--schedule=${s.schedule}`,
    `--time-zone=${s.timeZone}`,
    `--uri=${desired.uri}`,
    `--http-method=${s.httpMethod}`,
    `--oidc-service-account-email=${desired.serviceAccountEmail}`,
    `--oidc-token-audience=${desired.audience}`,
    `--attempt-deadline=${s.attemptDeadline}`,
    `--max-retry-attempts=${s.retryCount}`,
    `--min-backoff=${s.minBackoffDuration}`,
    `--max-backoff=${s.maxBackoffDuration}`,
    `--description=${s.description}`,
  ];
}

/** The subset of `gcloud run revisions describe --format=json` this module reads. */
export interface RunRevision {
  metadata?: { name?: string };
  spec?: { containers?: Array<{ env?: Array<{ name: string; value?: string }> }> };
}

/** Empty when the revision verifies tokens for exactly this audience and service account. */
export function revisionEnvProblems(revision: RunRevision, desired: DesiredJob): string[] {
  const name = revision.metadata?.name ?? "<unknown revision>";
  const env = new Map((revision.spec?.containers?.[0]?.env ?? []).map((entry) => [entry.name, entry.value]));
  const problems: string[] = [];
  for (const [key, wanted] of [
    ["MAINTENANCE_OIDC_AUDIENCE", desired.audience],
    ["MAINTENANCE_OIDC_SERVICE_ACCOUNT", desired.serviceAccountEmail],
  ] as const) {
    const actual = env.get(key);
    if (actual !== wanted) {
      problems.push(`${name}: ${key} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(wanted)}.`);
    }
  }
  return problems;
}
