import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The alerting definitions are checked offline, since nothing here can
 * create them (that needs a notification channel, owner): every
 * log-based metric in setup-log-alerts.sh has a policy file, every
 * policy is well formed and counts a metric that exists, and every log
 * tag a metric matches is still written by the application — a renamed
 * tag would otherwise leave an alert that can never fire.
 */

/** Tags whose writer is not on this branch yet: the metric exists ahead of the code that feeds it. */
const PENDING_RELEASE: Record<string, string> = {
  CREDIT_NOTE_FAILED: "PR #38 (GST invoices + credit notes), held for CA review",
};

const OPS = path.resolve(import.meta.dirname, "../ops");
const POLICIES = path.join(OPS, "alert-policies");
const SRC = path.resolve(import.meta.dirname, "../../src");

interface Policy {
  displayName: string;
  severity: string;
  documentation: { content: string };
  conditions: { conditionThreshold?: { filter: string }; conditionAbsent?: { filter: string; duration: string } }[];
  notificationChannels: string[];
  alertStrategy: { autoClose: string };
}

const script = readFileSync(path.join(OPS, "setup-log-alerts.sh"), "utf8");
const metrics = [...script.matchAll(/^\s*"(vokr_[a-z_]+)\|(.+?)\|/gm)].map(([, name, filter]) => ({ name, filter }));
const policyFiles = readdirSync(POLICIES).filter((file) => file.startsWith("vokr_") && file.endsWith(".json"));
const policies = policyFiles.map((file) => ({ file, policy: JSON.parse(readFileSync(path.join(POLICIES, file), "utf8")) as Policy }));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
const source = sourceFiles(SRC).map((file) => readFileSync(file, "utf8")).join("\n");

function metricOf(policy: Policy): string | undefined {
  const condition = policy.conditions[0];
  const filter = condition.conditionThreshold?.filter ?? condition.conditionAbsent?.filter ?? "";
  return /logging\.googleapis\.com\/user\/(vokr_[a-z_]+)/.exec(filter)?.[1];
}

describe("alert policies", () => {
  it("parses the metric list from the script", () => {
    expect(metrics.length).toBeGreaterThanOrEqual(12);
  });

  it("every metric is alerted on by exactly one policy", () => {
    for (const { name } of metrics) {
      const watchers = policies.filter(({ policy }) => metricOf(policy) === name);
      // vokr_maintenance_finished is watched for absence by vokr_maintenance_absent.
      expect(watchers.map(({ file }) => file), name).toHaveLength(1);
    }
  });

  it("every policy counts a metric the script creates, or is the uptime policy", () => {
    const names = new Set(metrics.map(({ name }) => name));
    for (const { file, policy } of policies) {
      const metric = metricOf(policy);
      if (metric === undefined) {
        expect(file).toBe("vokr_uptime_health.json");
        expect(policy.conditions[0].conditionThreshold?.filter).toContain("${UPTIME_CHECK_ID}");
      } else {
        expect(names.has(metric), `${file} → ${metric}`).toBe(true);
      }
    }
  });

  it("every policy is well formed: unique name, severity, runbook, channel placeholder, auto-close", () => {
    const names = policies.map(({ policy }) => policy.displayName);
    expect(new Set(names).size).toBe(names.length);
    for (const { file, policy } of policies) {
      expect(policy.displayName, file).toMatch(/^Vokr: /);
      expect(["CRITICAL", "ERROR", "WARNING"], file).toContain(policy.severity);
      expect(policy.documentation.content, file).toContain("alerting.md");
      expect(policy.notificationChannels, file).toEqual(["${NOTIFICATION_CHANNEL}"]);
      expect(policy.alertStrategy.autoClose, file).toBe("86400s");
      expect(policy.conditions, file).toHaveLength(1);
    }
  });

  it("every money-disagreement alert is CRITICAL", () => {
    for (const metric of ["vokr_order_orphan", "vokr_unmatched_payment", "vokr_amount_mismatch"]) {
      expect(policies.find(({ policy }) => metricOf(policy) === metric)?.policy.severity, metric).toBe("CRITICAL");
    }
  });

  it("every tag a metric matches is still written by the application", () => {
    for (const { name, filter } of metrics) {
      for (const [, tag] of filter.matchAll(/textPayload:\\"(.+?)\\"/g)) {
        // `reason=amount_mismatch` is written as `reason=${reason}` with the value a literal elsewhere.
        const keyValue = /^([a-z_]+)=([a-z_]+)$/.exec(tag);
        const written = keyValue
          ? source.includes(`${keyValue[1]}=\${`) && source.includes(`"${keyValue[2]}"`)
          : source.includes(tag.replace(/ok=false$/, "ok="));
        if (tag in PENDING_RELEASE) {
          // Self-cleaning: once the owning PR lands, the tag is in the source and this entry must go.
          expect(written, `${tag} is now written — remove it from PENDING_RELEASE`).toBe(false);
          continue;
        }
        expect(written, `${name}: ${tag}`).toBe(true);
      }
    }
  });

  it("the uptime check probes the public health endpoint through Cloudflare", () => {
    const check = JSON.parse(readFileSync(path.join(POLICIES, "uptime-check-health.json"), "utf8"));
    expect(check.monitoredResource.labels.host).toBe("vokr.shop");
    expect(check.httpCheck).toMatchObject({ path: "/api/health", useSsl: true, validateSsl: true });
    expect(check.period).toBe("300s");
  });
});
