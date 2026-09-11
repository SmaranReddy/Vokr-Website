import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import {
  assertServiceabilityLookupAllowed,
  getServiceability,
} from "@/server/shipping/serviceability";
import { serviceabilityQuerySchema } from "@/server/checkout/schemas";

/** Unauthenticated by design — no `getSession()` call. See Security Requirements, plan §5 Phase 6. */
export async function GET(request: NextRequest) {
  try {
    await assertServiceabilityLookupAllowed(request);

    const parsed = serviceabilityQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      throw new ValidationError("Invalid query parameters.");
    }

    const result = await getServiceability(parsed.data.pincode);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("shipping/serviceability", requestId, error);
    return NextResponse.json(body, { status });
  }
}
