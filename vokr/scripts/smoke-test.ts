/**
 * Phase 19 deployment smoke test. Run against a live deployment
 * (`SMOKE_TEST_BASE_URL`) after every CI deploy — a non-zero exit fails
 * the pipeline and triggers rollback (plan §Phase 19, task 12).
 *
 * Only checks routes and API shapes that exist in the codebase today.
 * Two items named in the plan are deliberately not implemented yet and
 * must be added when their phase lands:
 *   - "a PDP" beyond a reachable slug: full product-detail content
 *     assertions belong with Phase 4/13 catalog rendering work.
 *   - "a webhook signature rejection": there is no webhook endpoint
 *     until Phase 7 (Razorpay Payments) exists.
 */

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const baseUrl = process.env.SMOKE_TEST_BASE_URL;
if (!baseUrl) {
  console.error("SMOKE_TEST_BASE_URL is not set.");
  process.exit(1);
}

/**
 * D9 (ADR-031). This runs against the Cloud Run URL directly, and the
 * origin check refuses direct traffic that does not carry the Worker's
 * shared secret — every path but `/api/health`. The deploy job reads
 * ORIGIN_AUTH_SECRET out of Secret Manager and passes it here, so the
 * smoke test authenticates as the Worker does rather than being exempted
 * from the protection it is supposed to be testing behind. Unset (a
 * deployment with no origin secret) simply sends no header.
 */
const originAuthSecret = process.env.ORIGIN_AUTH_SECRET;

function smokeFetch(path: string): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    headers: originAuthSecret ? { "x-vokr-origin-auth": originAuthSecret } : {},
  });
}

async function checkHealth(): Promise<CheckResult> {
  const res = await smokeFetch("/api/health");
  const body = (await res.json().catch(() => null)) as { status?: string } | null;
  const ok = res.status === 200 && body?.status === "ok";
  return { name: "GET /api/health", ok, detail: `status=${res.status} body=${JSON.stringify(body)}` };
}

async function checkHomepage(): Promise<CheckResult> {
  const res = await smokeFetch("/");
  return { name: "GET /", ok: res.status === 200, detail: `status=${res.status}` };
}

async function checkCatalogApi(): Promise<{ result: CheckResult; slug: string | null }> {
  const res = await smokeFetch("/api/catalog/products");
  const body = (await res.json().catch(() => null)) as {
    products?: Array<{ slug?: string }>;
  } | null;
  const products = body?.products ?? [];
  const ok = res.status === 200 && Array.isArray(products) && products.length > 0;
  const slug = products[0]?.slug ?? null;
  return {
    result: {
      name: "GET /api/catalog/products",
      ok,
      detail: `status=${res.status} products=${products.length}`,
    },
    slug,
  };
}

async function checkProductPage(slug: string | null): Promise<CheckResult> {
  if (!slug) {
    return { name: "GET /shop/[slug]", ok: false, detail: "no product slug available from catalog API" };
  }
  const res = await smokeFetch(`/shop/${slug}`);
  return { name: `GET /shop/${slug}`, ok: res.status === 200, detail: `status=${res.status}` };
}

/**
 * D9 (ADR-031), the inverse of every check above: an *unauthenticated*
 * request straight to the origin must be refused. Skipped when no origin
 * secret is configured, because then there is nothing to enforce and the
 * app is expected to pass everything through.
 *
 * This exists because the check shipped once and sat inert in production
 * (revision vokr-00014-776) — the code was live but the secret was not
 * mounted, so it failed open and nothing looked wrong. A deploy-time
 * assertion on the mount catches that; this catches the broader claim,
 * that the bypass is actually closed from the outside.
 */
async function checkOriginProtection(): Promise<CheckResult | null> {
  if (!originAuthSecret) return null;
  const res = await fetch(new URL("/", baseUrl));
  const ok = res.status !== 200;
  return {
    name: "GET / without the origin secret is refused",
    ok,
    detail: `status=${res.status}${ok ? "" : " — the run.app bypass is OPEN"}`,
  };
}

async function main() {
  const results: CheckResult[] = [];

  results.push(await checkHealth());
  results.push(await checkHomepage());

  const originCheck = await checkOriginProtection();
  if (originCheck) results.push(originCheck);

  const { result: catalogResult, slug } = await checkCatalogApi();
  results.push(catalogResult);
  results.push(await checkProductPage(slug));

  let failed = false;
  for (const r of results) {
    const line = `${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`;
    console.log(line);
    if (!r.ok) failed = true;
  }

  if (failed) {
    console.error("\nSmoke test FAILED.");
    process.exit(1);
  }
  console.log("\nSmoke test passed.");
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
