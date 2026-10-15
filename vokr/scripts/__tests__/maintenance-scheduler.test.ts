import { describe, expect, it } from "vitest";

import {
  MAINTENANCE_JOB_SETTINGS,
  desiredJob,
  expectedAudience,
  planSchedulerJob,
  revisionEnvProblems,
  schedulerJobArgs,
  validateMaintenanceConfig,
  type SchedulerJob,
} from "../lib/maintenance-scheduler";

const AUDIENCE = "https://vokr.shop/api/jobs/maintenance";
const SA = "vokr-scheduler@vokr-website.iam.gserviceaccount.com";
const desired = desiredJob(AUDIENCE, SA);

const good = {
  siteUrl: "https://vokr.shop",
  projectId: "vokr-website",
  audience: AUDIENCE,
  serviceAccount: SA,
};

/** A job exactly as `gcloud scheduler jobs list --format=json` would return the desired one. */
function liveJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  const s = MAINTENANCE_JOB_SETTINGS;
  return {
    name: "projects/vokr-website/locations/asia-south1/jobs/vokr-maintenance",
    schedule: s.schedule,
    timeZone: s.timeZone,
    state: "ENABLED",
    attemptDeadline: s.attemptDeadline,
    description: s.description,
    retryConfig: {
      retryCount: s.retryCount,
      minBackoffDuration: s.minBackoffDuration,
      maxBackoffDuration: s.maxBackoffDuration,
    },
    httpTarget: { uri: AUDIENCE, httpMethod: "POST", oidcToken: { audience: AUDIENCE, serviceAccountEmail: SA } },
    ...overrides,
  };
}

const keepWarm: SchedulerJob = {
  name: "projects/vokr-website/locations/asia-south1/jobs/vokr-keep-warm",
  httpTarget: { uri: "https://vokr-plxgen7xla-el.a.run.app/api/health", httpMethod: "GET" },
};

describe("expectedAudience", () => {
  it("is the endpoint URL on the site's origin", () => {
    expect(expectedAudience("https://vokr.shop")).toBe(AUDIENCE);
    expect(expectedAudience("https://vokr.shop/")).toBe(AUDIENCE);
  });

  it("refuses anything but a bare https origin", () => {
    for (const url of [undefined, "", "vokr.shop", "http://vokr.shop", "https://vokr.shop/shop", "https://vokr.shop/?a=1", "https://u:p@vokr.shop"]) {
      expect(expectedAudience(url)).toBeNull();
    }
  });
});

describe("validateMaintenanceConfig", () => {
  it("accepts the production values", () => {
    expect(validateMaintenanceConfig(good)).toEqual([]);
  });

  it("refuses an audience that differs from the endpoint URL by anything", () => {
    for (const audience of [
      "https://vokr.shop",
      "https://vokr.shop/api/jobs/maintenance/",
      "https://www.vokr.shop/api/jobs/maintenance",
      "https://vokr-plxgen7xla-el.a.run.app/api/jobs/maintenance",
    ]) {
      expect(validateMaintenanceConfig({ ...good, audience })).toHaveLength(1);
    }
  });

  it("refuses a service account outside the project or a Google-managed one", () => {
    for (const serviceAccount of [
      "vokr-scheduler@other-project.iam.gserviceaccount.com",
      "978877857702-compute@developer.gserviceaccount.com",
      "service-978877857702@gcp-sa-cloudscheduler.iam.gserviceaccount.com",
      "someone@gmail.com",
      `${SA} `,
    ]) {
      expect(validateMaintenanceConfig({ ...good, serviceAccount })).toHaveLength(1);
    }
  });

  it("reports every missing value rather than defaulting it", () => {
    expect(
      validateMaintenanceConfig({ siteUrl: undefined, projectId: undefined, audience: undefined, serviceAccount: undefined }),
    ).toHaveLength(4);
  });
});

describe("planSchedulerJob", () => {
  it("creates the job when it does not exist, ignoring unrelated jobs", () => {
    expect(planSchedulerJob([keepWarm], desired)).toEqual({ action: "create", warnings: [] });
  });

  it("does nothing when the live job already matches — re-running is safe", () => {
    expect(planSchedulerJob([keepWarm, liveJob()], desired)).toEqual({ action: "none", warnings: [] });
  });

  it("updates a drifted job and names every drifted field", () => {
    const plan = planSchedulerJob(
      [
        liveJob({
          schedule: "*/15 * * * *",
          httpTarget: { uri: AUDIENCE, httpMethod: "GET", oidcToken: { audience: "https://vokr.shop", serviceAccountEmail: SA } },
        }),
      ],
      desired,
    );
    expect(plan.action).toBe("update");
    if (plan.action !== "update") return;
    expect(plan.drift.map((line) => line.split(":")[0])).toEqual(["schedule", "httpTarget.httpMethod", "oidcToken.audience"]);
  });

  it("treats a job with no retry config as zero retries, so it is updated", () => {
    const plan = planSchedulerJob([liveJob({ retryConfig: undefined })], desired);
    expect(plan.action).toBe("update");
  });

  it("refuses to add a second job that calls the same endpoint", () => {
    const other = liveJob({ name: "projects/vokr-website/locations/asia-south1/jobs/maintenance-old" });
    const plan = planSchedulerJob([other], desired);
    expect(plan.action).toBe("refuse");
  });

  it("reports a paused job but never resumes it", () => {
    expect(planSchedulerJob([liveJob({ state: "PAUSED" })], desired)).toEqual({
      action: "none",
      warnings: ["job vokr-maintenance is PAUSED; it is left that way."],
    });
  });
});

describe("schedulerJobArgs", () => {
  it("names the endpoint as both target and exact OIDC audience, POST, every 5 minutes", () => {
    const args = schedulerJobArgs("create", desired, { projectId: "vokr-website", region: "asia-south1" });
    expect(args.slice(0, 5)).toEqual(["scheduler", "jobs", "create", "http", "vokr-maintenance"]);
    expect(args).toContain("--location=asia-south1");
    expect(args).toContain(`--uri=${AUDIENCE}`);
    expect(args).toContain(`--oidc-token-audience=${AUDIENCE}`);
    expect(args).toContain(`--oidc-service-account-email=${SA}`);
    expect(args).toContain("--http-method=POST");
    expect(args).toContain("--schedule=*/5 * * * *");
    expect(args).toContain("--max-retry-attempts=1");
  });

  it("keeps the attempt deadline under Cloudflare's 100 s proxy timeout", () => {
    expect(Number.parseInt(MAINTENANCE_JOB_SETTINGS.attemptDeadline, 10)).toBeLessThan(100);
  });
});

describe("revisionEnvProblems", () => {
  const revision = (env: Array<{ name: string; value?: string }>) => ({
    metadata: { name: "vokr-00023-abc" },
    spec: { containers: [{ env }] },
  });

  it("passes a revision that verifies exactly this audience and account", () => {
    expect(
      revisionEnvProblems(
        revision([
          { name: "DATABASE_URL" },
          { name: "MAINTENANCE_OIDC_AUDIENCE", value: AUDIENCE },
          { name: "MAINTENANCE_OIDC_SERVICE_ACCOUNT", value: SA },
        ]),
        desired,
      ),
    ).toEqual([]);
  });

  it("flags the current production revision, which has neither", () => {
    expect(revisionEnvProblems(revision([{ name: "DATABASE_URL" }, { name: "ORIGIN_AUTH_SECRET" }]), desired)).toHaveLength(2);
  });

  it("flags a one-character audience mismatch", () => {
    expect(
      revisionEnvProblems(
        revision([
          { name: "MAINTENANCE_OIDC_AUDIENCE", value: `${AUDIENCE}/` },
          { name: "MAINTENANCE_OIDC_SERVICE_ACCOUNT", value: SA },
        ]),
        desired,
      ),
    ).toHaveLength(1);
  });
});
