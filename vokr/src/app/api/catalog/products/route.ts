import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { listProducts } from "@/server/catalog";

export async function GET() {
  try {
    const products = await listProducts();
    return NextResponse.json({ products });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
