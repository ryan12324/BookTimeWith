import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production container startup", () => {
  it("runs the locked migration command before starting the HTTP server", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    const entrypoint = readFileSync(
      path.join(root, "scripts/docker-entrypoint.sh"),
      "utf8",
    );
    const migrationRunner = readFileSync(
      path.join(root, "scripts/migrate.mjs"),
      "utf8",
    );

    expect(dockerfile).toContain(
      'COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs',
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm",
    );
    expect(dockerfile).toContain(
      'CMD ["sh", "/app/scripts/docker-entrypoint.sh"]',
    );
    expect(entrypoint).toContain("set -eu");
    expect(entrypoint.indexOf("node /app/scripts/migrate.mjs")).toBeGreaterThan(
      -1,
    );
    expect(entrypoint.indexOf("exec node /app/server.js")).toBeGreaterThan(
      entrypoint.indexOf("node /app/scripts/migrate.mjs"),
    );
    expect(migrationRunner).toContain("pg_advisory_lock");
    expect(migrationRunner).toContain("pg_advisory_unlock");
  });

  it("fails closed before startup when DATABASE_URL is absent", () => {
    const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "DATABASE_URL is required before database migrations can run",
    );
    expect(result.stdout).not.toContain("PostgreSQL migrations are current.");
  });
});
