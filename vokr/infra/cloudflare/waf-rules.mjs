// The Phase 16 edge rules (plan §5 Phase 16, task 7) as Cloudflare
// Rulesets API payloads, and a runner that is a DRY RUN unless --apply.
//
//   node infra/cloudflare/waf-rules.mjs                 # print the payloads, change nothing
//   CF_API_TOKEN=… CF_ZONE_ID=… node infra/cloudflare/waf-rules.mjs --apply
//
// Optional: ADMIN_IPS="203.0.113.7 2001:db8::1" restricts /admin to those
// addresses (rule 2 blocks everyone else); without it rule 2 is a managed
// challenge. BAD_ASNS="64496 64497" adds an ASN block to rule 5 — only ASNs
// someone has actually seen abusing the site; none are guessed here.
//
// --apply REPLACES the zone's custom-rules and rate-limit entrypoints with
// exactly these rules: read what is there first (the runner prints it).
// Free plan limits respected: 5 custom rules, 1 rate-limiting rule with a
// 10 s period and 10 s mitigation, counted per IP + colo.
//
// Bot Fight Mode is NOT set here. On the Free plan it cannot be skipped
// for a path, and it can challenge server-to-server callers — the Razorpay
// webhook. Turn it on only after a webhook delivery has been proven
// through it (payments are parked), see waf-rules.md.

/** Paths machines call with no browser: never challenged. */
export const MACHINE_PATHS = ["/api/webhooks/razorpay", "/api/csp-report", "/api/jobs/maintenance", "/api/health"];

const path = "lower(http.request.uri.path)";
const machineExempt = `not ${path} in {${MACHINE_PATHS.map((p) => `"${p}"`).join(" ")}}`;

const SCANNER_SIGNATURES = [
  `${path} contains "/.env"`,
  `${path} contains "/.git"`,
  `${path} contains "/wp-"`,
  `${path} contains "/phpmyadmin"`,
  `${path} contains "/cgi-bin"`,
  `ends_with(${path}, ".php")`,
];

const SUSPICIOUS_AGENTS = ["curl", "wget", "python-requests", "python-urllib", "go-http-client", "scrapy", "httpclient", "libwww"];

/** @param {{ adminIps?: string[]; badAsns?: string[] }} [options] */
export function customRules({ adminIps = [], badAsns = [] } = {}) {
  const admin = `(starts_with(${path}, "/admin") or starts_with(${path}, "/api/admin"))`;
  const scanners = `(${SCANNER_SIGNATURES.join(" or ")})`;
  return [
    {
      description: "vokr-1: non-India traffic to checkout/payments is challenged (ships only within India)",
      expression: `(starts_with(${path}, "/api/checkout/") or starts_with(${path}, "/api/payments/") or ${path} eq "/checkout") and ip.src.country ne "IN"`,
      action: "managed_challenge",
    },
    adminIps.length > 0
      ? {
          description: "vokr-2: admin only from the listed IPs",
          expression: `${admin} and not ip.src in {${adminIps.join(" ")}}`,
          action: "block",
        }
      : {
          description: "vokr-2: admin challenged (no IP list configured)",
          expression: admin,
          action: "managed_challenge",
        },
    {
      description: "vokr-4: POST /api/* with a missing or scripted user agent is challenged",
      expression: `http.request.method eq "POST" and starts_with(${path}, "/api/") and ${machineExempt} and (len(http.user_agent) lt 10 or ${SUSPICIOUS_AGENTS.map((agent) => `lower(http.user_agent) contains "${agent}"`).join(" or ")})`,
      action: "managed_challenge",
    },
    {
      description: "vokr-5: scanner probes (and listed ASNs) are blocked",
      expression: badAsns.length > 0 ? `${scanners} or (starts_with(${path}, "/api/") and ip.src.asnum in {${badAsns.join(" ")}})` : scanners,
      action: "block",
    },
  ];
}

/** Rule 3 lives in the rate-limiting phase (the Free plan's one rule). */
export function rateLimitRules() {
  return [
    {
      description: "vokr-3: guest order lookup and returns, per IP, ahead of the application",
      expression: `http.request.method eq "POST" and (${path} eq "/api/orders/lookup" or starts_with(${path}, "/api/returns/"))`,
      action: "block",
      ratelimit: {
        characteristics: ["ip.src", "cf.colo.id"],
        period: 10,
        requests_per_period: 5,
        mitigation_timeout: 10,
      },
    },
  ];
}

const PHASES = { custom: "http_request_firewall_custom", ratelimit: "http_ratelimit" };

async function cf(method, url, token, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!json.success && response.status !== 404) {
    throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(json.errors)}`);
  }
  return json;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const split = (value) => (value ?? "").split(/[\s,]+/).filter(Boolean);
  const custom = customRules({ adminIps: split(process.env.ADMIN_IPS), badAsns: split(process.env.BAD_ASNS) });
  const ratelimit = rateLimitRules();
  if (!apply) {
    console.log("DRY RUN — nothing sent. Payloads:");
    console.log(JSON.stringify({ [PHASES.custom]: { rules: custom }, [PHASES.ratelimit]: { rules: ratelimit } }, null, 2));
    return;
  }
  const token = process.env.CF_API_TOKEN;
  const zone = process.env.CF_ZONE_ID;
  if (!token || !zone) throw new Error("--apply needs CF_API_TOKEN and CF_ZONE_ID.");
  for (const [phase, rules] of [
    [PHASES.custom, custom],
    [PHASES.ratelimit, ratelimit],
  ]) {
    const current = await cf("GET", `/zones/${zone}/rulesets/phases/${phase}/entrypoint`, token);
    console.log(`${phase}: replacing ${current.result?.rules?.length ?? 0} existing rule(s):`);
    for (const rule of current.result?.rules ?? []) console.log(`  - ${rule.description ?? rule.id}`);
    await cf("PUT", `/zones/${zone}/rulesets/phases/${phase}/entrypoint`, token, { rules });
    console.log(`${phase}: ${rules.length} rule(s) applied.`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").replace(/^.*?(?=infra\/)/, ""))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
