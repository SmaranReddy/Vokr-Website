import type { NextRequest } from "next/server";
import { z } from "zod";

import { OrderStatus } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { handleAdmin } from "@/server/admin/route";
import { exportShiprocketCsv } from "@/server/admin/shiprocket-csv";

const querySchema = z.object({ status: z.enum([OrderStatus.preparing, OrderStatus.confirmed]).default(OrderStatus.preparing) });

/** `GET /api/admin/exports/shiprocket?status=preparing` — the Shiprocket bulk-upload CSV; audit-logged (plan §5 Phase 10, task 2). */
export async function GET(request: NextRequest) {
  return handleAdmin(request, "exports/shiprocket", async (admin, requestId) => {
    const parsed = querySchema.safeParse({ status: request.nextUrl.searchParams.get("status") ?? undefined });
    if (!parsed.success) throw new ValidationError("status must be preparing or confirmed.");
    const { csv, orderCount } = await exportShiprocketCsv(admin.actor, parsed.data.status, requestId);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="vokr-shiprocket-${parsed.data.status}-${stamp}.csv"`,
        "x-order-count": String(orderCount),
      },
    });
  });
}
