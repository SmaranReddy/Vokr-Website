import { describe, expect, it } from "vitest";

import { customRules, MACHINE_PATHS, rateLimitRules } from "../../../../infra/cloudflare/waf-rules.mjs";

/**
 * Plan §5 Phase 16 task 7: the edge rules as written (not yet applied to
 * the zone). These guard the payload shape the runner sends and the
 * exemptions a careless edit would break.
 */
describe("Cloudflare WAF rules", () => {
  const rules = customRules();

  it("fit the Free plan: at most 5 custom rules and one 10 s rate-limit rule", () => {
    expect(rules.length + rateLimitRules().length).toBeLessThanOrEqual(5);
    const [limit] = rateLimitRules();
    expect(rateLimitRules()).toHaveLength(1);
    expect(limit?.ratelimit).toMatchObject({ period: 10, mitigation_timeout: 10, characteristics: ["ip.src", "cf.colo.id"] });
  });

  it("never challenge the paths machines call (webhook, CSP reports, Scheduler, health)", () => {
    const agentRule = rules.find((rule) => rule.description.startsWith("vokr-4"));
    for (const path of MACHINE_PATHS) expect(agentRule?.expression).toContain(`"${path}"`);
    const geoRule = rules.find((rule) => rule.description.startsWith("vokr-1"));
    expect(geoRule?.expression).not.toContain("/api/webhooks");
  });

  it("match on the lower-cased path, so /%61dmin-style and case tricks do not slip past", () => {
    for (const rule of [...rules, ...rateLimitRules()]) {
      expect(rule.expression).not.toMatch(/(?<!lower\()http\.request\.uri\.path/);
    }
  });

  it("admin: blocked outside the IP list when one is given, otherwise challenged", () => {
    const listed = customRules({ adminIps: ["203.0.113.7"] }).find((rule) => rule.description.startsWith("vokr-2"));
    expect(listed).toMatchObject({ action: "block" });
    expect(listed?.expression).toContain("not ip.src in {203.0.113.7}");
    expect(rules.find((rule) => rule.description.startsWith("vokr-2"))).toMatchObject({ action: "managed_challenge" });
  });

  it("guesses no ASNs: rule 5 lists them only when given", () => {
    expect(rules.find((rule) => rule.description.startsWith("vokr-5"))?.expression).not.toContain("asnum");
    expect(customRules({ badAsns: ["64496"] }).find((rule) => rule.description.startsWith("vokr-5"))?.expression).toContain(
      "ip.src.asnum in {64496}",
    );
  });
});
