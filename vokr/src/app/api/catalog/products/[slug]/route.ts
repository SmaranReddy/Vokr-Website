import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { getProductBySlug } from "@/server/catalog";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/catalog/products/[slug]">,
) {
  try {
    const { slug } = await context.params;
    const product = await getProductBySlug(slug);
    return NextResponse.json({ product });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
