import { LogBudget, parseCspReport, readCapped } from "@/server/net/csp-report";

/** Module-level: one budget per server instance. */
const budget = new LogBudget();

/**
 * `POST /api/csp-report` — where browsers send Content-Security-Policy
 * violations while the policy is report-only (plan §5 Phase 16, task 2).
 * Log-only: no database, no cookies, no identity; always 204 so a browser
 * never retries. Exempt from the cross-site check (`csrf.ts`): browsers
 * send these themselves, and it changes nothing.
 */
export async function POST(request: Request) {
  const raw = await readCapped(request);
  if (raw !== null) {
    for (const violation of parseCspReport(raw)) {
      if (!budget.take()) break;
      console.warn(
        `[csp] violation directive=${violation.directive} blocked=${violation.blocked} document=${violation.document} disposition=${violation.disposition}`,
      );
    }
  }
  return new Response(null, { status: 204 });
}
