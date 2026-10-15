/**
 * Cloud Scheduler job 3 — `POST https://vokr.shop/api/jobs/maintenance`
 * every 5 minutes, authenticated by an OIDC token issued to
 * `vokr-scheduler@vokr-website.iam.gserviceaccount.com`.
 *
 *   npx tsx scripts/maintenance-scheduler.ts check-config   # deploy.yml, from env
 *   npx tsx scripts/maintenance-scheduler.ts assert-revision --revision=… --project=… --region=…   # deploy.yml
 *   npx tsx scripts/maintenance-scheduler.ts plan           # operator, read-only (default)
 *   npx tsx scripts/maintenance-scheduler.ts apply          # operator, creates/updates the job
 *
 * The job is operator-managed, like `vokr-keep-warm`: the deploy service
 * account has no Cloud Scheduler rights and should not be given them (it
 * would also need actAs on the scheduler account). This script is the
 * single, checked-in definition of the job, and it grants no IAM.
 *
 * `plan` and `apply` read the project, refuse when another job already
 * targets the endpoint or when any serving revision does not carry the
 * same MAINTENANCE_OIDC_* values (the job would get a 401 or 503 every 5
 * minutes), and print the exact gcloud command. `apply` then runs it and
 * re-reads the job to prove it converged. See
 * docs/infrastructure/cloud-run.md, "Maintenance job".
 */

import { execFileSync } from "node:child_process";

import {
  desiredJob,
  expectedAudience,
  planSchedulerJob,
  revisionEnvProblems,
  schedulerJobArgs,
  validateMaintenanceConfig,
  type RunRevision,
  type SchedulerJob,
} from "./lib/maintenance-scheduler";

const DEFAULTS = {
  projectId: "vokr-website",
  region: "asia-south1",
  service: "vokr",
  siteUrl: "https://vokr.shop",
  serviceAccount: "vokr-scheduler@vokr-website.iam.gserviceaccount.com",
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** gcloud is `gcloud.cmd` on Windows, which Node will only start through a shell. */
function gcloud(args: string[]): string {
  if (process.platform !== "win32") {
    return execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  const quoted = args.map((arg) => {
    if (/["%^&|<>!]/.test(arg)) fail(`refusing to pass ${JSON.stringify(arg)} through cmd.exe`);
    return /[\s*]/.test(arg) ? `"${arg}"` : arg;
  });
  return execFileSync(["gcloud", ...quoted].join(" "), { encoding: "utf8", shell: "cmd.exe", stdio: ["ignore", "pipe", "pipe"] });
}

function gcloudJson<T>(args: string[]): T {
  return JSON.parse(gcloud([...args, "--format=json"])) as T;
}

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function checkConfig(): void {
  const problems = validateMaintenanceConfig({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    projectId: process.env.GCP_PROJECT_ID,
    audience: process.env.MAINTENANCE_OIDC_AUDIENCE,
    serviceAccount: process.env.MAINTENANCE_OIDC_SERVICE_ACCOUNT,
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    process.exit(1);
  }
  console.log(
    `OK: maintenance OIDC audience ${process.env.MAINTENANCE_OIDC_AUDIENCE}, service account ${process.env.MAINTENANCE_OIDC_SERVICE_ACCOUNT}.`,
  );
}

/** deploy.yml, after the deploy: the new revision carries exactly the repository variables. */
function assertRevision(): void {
  const revision = option("revision", "");
  const projectId = option("project", "");
  const region = option("region", "");
  if (!revision || !projectId || !region) fail("assert-revision needs --revision, --project and --region.");
  const { MAINTENANCE_OIDC_AUDIENCE: audience, MAINTENANCE_OIDC_SERVICE_ACCOUNT: account } = process.env;
  if (!audience || !account) fail("MAINTENANCE_OIDC_AUDIENCE / MAINTENANCE_OIDC_SERVICE_ACCOUNT are not set.");
  const problems = revisionEnvProblems(
    gcloudJson<RunRevision>(["run", "revisions", "describe", revision, `--project=${projectId}`, `--region=${region}`]),
    desiredJob(audience, account),
  );
  if (problems.length > 0) fail(problems.join(" "));
  console.log(`OK: ${revision} verifies scheduler tokens for ${audience} issued to ${account}.`);
}

function servingRevisions(projectId: string, region: string, service: string): string[] {
  const svc = gcloudJson<{ status?: { traffic?: Array<{ revisionName?: string; percent?: number }> } }>([
    "run",
    "services",
    "describe",
    service,
    `--project=${projectId}`,
    `--region=${region}`,
  ]);
  const names = (svc.status?.traffic ?? [])
    .filter((entry) => (entry.percent ?? 0) > 0 && entry.revisionName)
    .map((entry) => entry.revisionName as string);
  if (names.length === 0) fail(`service ${service} has no revision serving traffic.`);
  return names;
}

function schedule(apply: boolean): void {
  const projectId = option("project", DEFAULTS.projectId);
  const region = option("region", DEFAULTS.region);
  const service = option("service", DEFAULTS.service);
  const siteUrl = option("site-url", DEFAULTS.siteUrl);
  const serviceAccount = option("service-account", DEFAULTS.serviceAccount);

  const audience = expectedAudience(siteUrl);
  const configProblems = validateMaintenanceConfig({ siteUrl, projectId, audience: audience ?? undefined, serviceAccount });
  if (!audience || configProblems.length > 0) fail(configProblems.join(" "));
  const desired = desiredJob(audience, serviceAccount);

  // The account must exist; this script never creates it or grants it anything.
  gcloud(["iam", "service-accounts", "describe", serviceAccount, `--project=${projectId}`, "--format=value(email)"]);

  const revisionProblems = servingRevisions(projectId, region, service).flatMap((name) =>
    revisionEnvProblems(
      gcloudJson<RunRevision>(["run", "revisions", "describe", name, `--project=${projectId}`, `--region=${region}`]),
      desired,
    ),
  );

  const jobs = gcloudJson<SchedulerJob[]>(["scheduler", "jobs", "list", `--project=${projectId}`, `--location=${region}`]);
  const plan = planSchedulerJob(jobs, desired);

  console.log(`Job ${desired.id}: POST ${desired.uri}, OIDC ${desired.serviceAccountEmail}, audience ${desired.audience}`);
  if (plan.action === "refuse") fail(plan.reasons.join(" "));
  for (const warning of plan.warnings) console.warn(`WARN: ${warning}`);
  if (plan.action === "none") {
    console.log("OK: the job already matches; nothing to do.");
    if (revisionProblems.length > 0) fail(`the job exists but the service does not match it: ${revisionProblems.join(" ")}`);
    return;
  }
  if (plan.action === "update") for (const line of plan.drift) console.log(`  drift ${line}`);

  if (revisionProblems.length > 0) {
    fail(
      `${revisionProblems.join(" ")} Deploy with the MAINTENANCE_OIDC_* repository variables set first (deploy.yml); ` +
        "a job created now would be refused on every run.",
    );
  }

  const args = schedulerJobArgs(plan.action, desired, { projectId, region });
  console.log(`\n${plan.action === "create" ? "Would create" : "Would update"}:\n  gcloud ${args.map((a) => (/[\s*]/.test(a) ? `"${a}"` : a)).join(" ")}`);
  if (!apply) {
    console.log("\nDry run. Re-run with `apply` to make this change.");
    return;
  }

  gcloud(args);
  const after = planSchedulerJob(
    gcloudJson<SchedulerJob[]>(["scheduler", "jobs", "list", `--project=${projectId}`, `--location=${region}`]),
    desired,
  );
  if (after.action !== "none") fail(`the job did not converge: ${JSON.stringify(after)}`);
  console.log(`OK: ${desired.id} ${plan.action}d and re-read; it matches the definition.`);
}

const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "plan";
if (command === "check-config") checkConfig();
else if (command === "assert-revision") assertRevision();
else if (command === "plan") schedule(false);
else if (command === "apply") schedule(true);
else fail(`unknown command ${command}; expected check-config, assert-revision, plan or apply.`);
