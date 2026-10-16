import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { getProductBySlug } from "@/server/catalog";
import { requestIdOf } from "@/server/net/request-id";

export async function GET(
  request: Request,
  context: RouteContext<"/api/catalog/products/[slug]">,
) {
  try {
    const { slug } = await context.params;
    const product = await getProductBySlug(slug);
    return NextResponse.json({ product });
  } catch (error) {
    const { status, body } = toErrorResponse(error, requestIdOf(request));
    return NextResponse.json(body, { status });
  }
}
