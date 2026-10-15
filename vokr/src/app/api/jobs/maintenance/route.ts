import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getMaintenanceOidcExpectation, handleMaintenanceRequest } from "@/server/jobs/handler";
import { runMaintenance } from "@/server/jobs/maintenance";
import { createGoogleKeyResolver } from "@/server/jobs/oidc";
import { requireRazorpayConfig } from "@/server/payments/config";
import { createRazorpayClient } from "@/server/payments/razorpay";

// One per instance, so Google's signing keys are cached across runs.
const resolveKey = createGoogleKeyResolver();

/** `null` when Razorpay is not configured — reconciliation is then reported `not_configured`, not failed. */
function razorpayOrNull(): ReturnType<typeof createRazorpayClient> | null {
  try {
    return createRazorpayClient(requireRazorpayConfig());
  } catch {
    return null;
  }
}

/**
 * Cloud Scheduler job 3 (plan §5 Phase 8, task 7). Not behind the
 * `ORDERING_ENABLED` gate: expiring holds and reconciling payments must
 * keep working whatever the storefront shows. Authenticated only by the
 * scheduler's OIDC token, verified in `src/server/jobs/oidc.ts`.
 */
export async function POST(request: NextRequest) {
  try {
    const result = await handleMaintenanceRequest({
      authorization: request.headers.get("authorization"),
      expected: getMaintenanceOidcExpectation(),
      resolveKey,
      run: () => {
        const razorpay = razorpayOrNull();
        return runMaintenance(razorpay, razorpay);
      },
    });
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("jobs/maintenance", requestId, error);
    return NextResponse.json(body, { status });
  }
}
