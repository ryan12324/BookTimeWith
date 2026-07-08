import type { Config } from "drizzle-kit";

/**
 * Drizzle config for phase-2 Postgres. `npm run db:generate` emits SQL migrations
 * from src/db/schema.ts. Set DATABASE_URL to run them (see .env.example).
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/booktimewith",
  },
} satisfies Config;
