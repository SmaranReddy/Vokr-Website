import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/client";

import { getServiceability } from "../serviceability";

/** Requires a running Postgres with migrations applied. Run via `npm run test:integration`. */

const seededPincodes: string[] = [];

afterEach(async () => {
  if (seededPincodes.length > 0) {
    await prisma.serviceablePincode.deleteMany({ where: { pincode: { in: seededPincodes } } });
    seededPincodes.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("shipping serviceability (plan §5 Phase 6, task 3)", () => {
  it("returns serviceable=false for a PIN code absent from serviceable_pincodes — fails closed", async () => {
    const result = await getServiceability("199999");
    expect(result).toEqual({ serviceable: false });
  });

  it("returns serviceability details for a seeded PIN code", async () => {
    const pincode = "400001";
    await prisma.serviceablePincode.create({
      data: { pincode, codEligible: true, estimatedDeliveryDays: 4 },
      select: { pincode: true },
    });
    seededPincodes.push(pincode);

    const result = await getServiceability(pincode);
    expect(result).toEqual({
      serviceable: true,
      codEligible: true,
      estimatedDeliveryDays: 4,
    });
  });

  it("a COD-ineligible PIN code reports serviceable but not COD-eligible", async () => {
    const pincode = "560001";
    await prisma.serviceablePincode.create({
      data: { pincode, codEligible: false, estimatedDeliveryDays: 6 },
      select: { pincode: true },
    });
    seededPincodes.push(pincode);

    const result = await getServiceability(pincode);
    expect(result).toEqual({
      serviceable: true,
      codEligible: false,
      estimatedDeliveryDays: 6,
    });
  });
});
