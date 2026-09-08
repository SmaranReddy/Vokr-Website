/**
 * CLI entrypoint: `prisma db seed` runs this file (see prisma7.config.ts).
 * The actual seeding logic lives in `./seed-data.ts` — shared with the
 * integration test so the test exercises the exact code path this
 * command runs, not a copy of it.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { seedCatalog } from "./seed-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local first.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

seedCatalog(prisma)
  .then(async ({ productCount, variantCount, inventoryCount }) => {
    console.log(
      `Seeded ${productCount} products, ${variantCount} variants, ${inventoryCount} inventory rows.`,
    );
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
