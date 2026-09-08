import { config } from "dotenv";
import path from "node:path";

// Integration tests run outside Next.js's own env loading, so load the
// same local secrets file the app and the Prisma CLI use. Requires a
// running Postgres — see docker-compose.yml and README.md.
config({ path: path.resolve(import.meta.dirname, ".env.local"), quiet: true });
