import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { listProducts } from "@/server/catalog";
import { requestIdOf } from "@/server/net/request-id";

export async function GET(request: Request) {
  try {
    const products = await listProducts();
    return NextResponse.json({ products });
  } catch (error) {
    const { status, body } = toErrorResponse(error, requestIdOf(request));
    return NextResponse.json(body, { status });
  }
}
