import { NextResponse } from "next/server";

import { prisma } from "@/server/db/client";

/**
 * Phase 19/20 health check. Must touch Postgres, not just answer 200 from
 * the Node process (AGENTS.md: "The keep-warm health check must touch
 * Postgres, not just Cloud Run") — this is what the Cloud Scheduler
 * keep-warm ping (every 5 minutes) relies on to prevent both Cloud Run
 * cold starts and Supabase's 7-day inactivity pause, and what the CI
 * deploy pipeline's smoke test asserts against.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
