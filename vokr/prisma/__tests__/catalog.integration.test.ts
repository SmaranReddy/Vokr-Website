import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../../src/generated/prisma/client";
import { seedCatalog } from "../seed-data";

/**
 * Requires a running Postgres with migrations applied — see
 * README.md ("Database — local development"). Run via
 * `npm run test:integration`, never as part of `npm run test`.
 */

let prisma: PrismaClient;

beforeAll(() => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — see README.md for local integration-test setup.",
    );
  }
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("catalog schema and seed (Phase 2)", () => {
  it("seeding twice is idempotent — row counts are identical", async () => {
    const first = await seedCatalog(prisma);
    const second = await seedCatalog(prisma);

    expect(second).toEqual(first);
    expect(first).toEqual({
      productCount: 5,
      variantCount: 27,
      inventoryCount: 27,
    });
  });

  it("rejects a negative quantity_on_hand", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      select: { id: true },
    });

    await expect(
      prisma.$executeRaw`UPDATE inventory SET quantity_on_hand = -1 WHERE variant_id = ${variant.id}::uuid`,
    ).rejects.toThrow(/inventory_quantity_on_hand_non_negative/);
  });

  it("rejects a negative quantity_reserved", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      select: { id: true },
    });

    await expect(
      prisma.$executeRaw`UPDATE inventory SET quantity_reserved = -1 WHERE variant_id = ${variant.id}::uuid`,
    ).rejects.toThrow(/inventory_quantity_reserved_non_negative/);
  });

  it("rejects quantity_reserved exceeding quantity_on_hand", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      select: { id: true },
    });

    await expect(
      prisma.$executeRaw`UPDATE inventory SET quantity_on_hand = 1, quantity_reserved = 2 WHERE variant_id = ${variant.id}::uuid`,
    ).rejects.toThrow(/inventory_reserved_not_exceeding_on_hand/);
  });

  it("rejects a duplicate sku", async () => {
    const existing = await prisma.productVariant.findFirstOrThrow({
      select: { sku: true, productId: true },
    });

    await expect(
      prisma.productVariant.create({
        data: {
          productId: existing.productId,
          sku: existing.sku,
          sizeLabel: "dupe-test",
          colorway: "dupe-test",
          pricePaise: 100,
          weightGrams: 1,
          position: 999,
        },
        select: { id: true },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("refuses to activate a variant whose product has no gst_rate_bps (decision D2 unresolved)", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { status: "draft" },
      select: { id: true, productId: true },
    });
    // Ensure the parent product genuinely has no rate for this assertion.
    await prisma.product.update({
      where: { id: variant.productId },
      data: { gstRateBps: null },
      select: { id: true },
    });

    await expect(
      prisma.productVariant.update({
        where: { id: variant.id },
        data: { status: "active" },
        select: { id: true },
      }),
    ).rejects.toThrow(/has no gst_rate_bps yet/);
  });

  it("allows activation once the product has a confirmed gst_rate_bps", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      select: { id: true, productId: true },
    });

    await prisma.product.update({
      where: { id: variant.productId },
      data: { gstRateBps: 1800, hsnCode: "6404" },
      select: { id: true },
    });

    const activated = await prisma.productVariant.update({
      where: { id: variant.id },
      data: { status: "active" },
      select: { status: true },
    });
    expect(activated.status).toBe("active");

    // Restore D2-unresolved state so this test file leaves the seed as
    // it found it — later tests, and a human re-running the suite,
    // should see the same "nothing is purchasable yet" starting point.
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { status: "draft" },
      select: { id: true },
    });
    await prisma.product.update({
      where: { id: variant.productId },
      data: { gstRateBps: null, hsnCode: null },
      select: { id: true },
    });
  });

  it("has Row Level Security enabled on products, product_variants and inventory", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean }[]
    >`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('products', 'product_variants', 'inventory')
    `;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(
        true,
      );
    }
  });
});
