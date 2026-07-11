import path from "node:path";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET as verifyEmail } from "../src/app/api/verify-email/route";
import { patchOwnerConfig } from "../src/db/repo";
import {
  generateIdentityToken,
  hashToken,
} from "../src/lib/auth-tokens";
import {
  SESSION_COOKIE,
  verifySessionDetails,
} from "../src/lib/session";

const OWNER_ID = "00000000-0000-4000-8000-000000000601";
const SERVICE_ID = "00000000-0000-4000-8000-000000000611";

describe("verified owner email changes", () => {
  const pg = new PGlite({ extensions: { btree_gist } });
  const db = drizzle(pg, { schema });

  beforeAll(async () => {
    vi.stubEnv("APP_URL", "https://booktimewith.com");
    vi.stubEnv(
      "AUTH_TOKEN_SECRET",
      "test-owner-identity-secret-that-is-long-enough",
    );
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    mocks.getDb.mockResolvedValue(db);
    await db.insert(schema.owners).values({
      id: OWNER_ID,
      email: "trusted@example.test",
      emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
      name: "Dana Owner",
      handle: "dana-identity",
      sessionVersion: 4,
      planStatus: "active",
      setupCompletedAt: new Date("2026-07-01T00:00:00Z"),
    });
    await db.insert(schema.services).values({
      id: SERVICE_ID,
      ownerId: OWNER_ID,
      name: "Consultation",
      durationMinutes: 60,
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pg.close();
  });

  it("keeps the trusted identity live until the exact pending address verifies", async () => {
    await expect(
      patchOwnerConfig(db, OWNER_ID, { email: "new@example.test" }),
    ).resolves.toMatchObject({ emailChanged: true });

    const pendingOwner = await db.query.owners.findFirst({
      where: (owner, { eq }) => eq(owner.id, OWNER_ID),
    });
    expect(pendingOwner).toMatchObject({
      email: "trusted@example.test",
      pendingEmail: "new@example.test",
      sessionVersion: 4,
    });

    const token = generateIdentityToken(4);
    const tokenId = "00000000-0000-4000-8000-000000000621";
    await db.insert(schema.authTokens).values({
      id: tokenId,
      kind: "email_verify",
      ownerId: OWNER_ID,
      identityEmail: "new@example.test",
      tokenHash: await hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.emailOutbox).values([
      {
        id: "00000000-0000-4000-8000-000000000631",
        ownerId: OWNER_ID,
        ownerRecipientVersion: 4,
        bookingId: null,
        toEmail: "client@example.test",
        fromLine: "Dana via booktimewith.com",
        replyTo: "trusted@example.test",
        subject: "Booking",
        template: "client-confirmation",
        html: "<p>booking</p>",
      },
      {
        id: "00000000-0000-4000-8000-000000000632",
        ownerId: OWNER_ID,
        ownerRecipientVersion: 4,
        toEmail: "trusted@example.test",
        fromLine: "booktimewith.com",
        subject: "Welcome",
        template: "welcome",
        html: "<p>welcome</p>",
      },
      {
        id: "00000000-0000-4000-8000-000000000633",
        ownerId: OWNER_ID,
        ownerRecipientVersion: 4,
        authTokenId: tokenId,
        toEmail: "new@example.test",
        fromLine: "booktimewith.com",
        subject: "Verify",
        template: "owner-verify-email",
        html: "<p>verify</p>",
      },
    ]);

    const url = new URL("https://booktimewith.com/api/verify-email");
    url.searchParams.set("token", token);
    const response = await verifyEmail(new Request(url));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.com/app/settings?verified=1",
    );
    const owner = await db.query.owners.findFirst({
      where: (row, { eq }) => eq(row.id, OWNER_ID),
    });
    expect(owner).toMatchObject({
      email: "new@example.test",
      pendingEmail: null,
      sessionVersion: 5,
    });
    expect(owner?.emailVerifiedAt).toBeInstanceOf(Date);

    const rows = await db.query.emailOutbox.findMany({
      orderBy: (row, { asc }) => [asc(row.id)],
    });
    expect(rows[0]).toMatchObject({
      toEmail: "client@example.test",
      replyTo: "new@example.test",
      ownerRecipientVersion: 5,
    });
    expect(rows[1]).toMatchObject({
      toEmail: "new@example.test",
      ownerRecipientVersion: 5,
    });
    expect(rows[2]).toMatchObject({ delivery: "expired", html: "" });
    await expect(db.query.authTokens.findMany()).resolves.toHaveLength(0);

    const cookie = response.headers
      .get("set-cookie")
      ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    await expect(
      verifySessionDetails(decodeURIComponent(cookie!)),
    ).resolves.toEqual({ ownerId: OWNER_ID, sessionVersion: 5 });
  });

  it("binds pre-deployment identity tokens during the 0016 upgrade", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(`
        CREATE TABLE "owners" (
          "id" uuid PRIMARY KEY,
          "email" text NOT NULL
        );
        CREATE TABLE "bookings" ("id" uuid PRIMARY KEY);
        CREATE TABLE "auth_tokens" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid,
          "kind" text NOT NULL
        );
        INSERT INTO "owners" VALUES
          ('${OWNER_ID}', 'legacy@example.test');
        INSERT INTO "auth_tokens" VALUES
          ('00000000-0000-4000-8000-000000000641', '${OWNER_ID}', 'owner_signin'),
          ('00000000-0000-4000-8000-000000000642', '${OWNER_ID}', 'email_verify'),
          ('00000000-0000-4000-8000-000000000643', '${OWNER_ID}', 'client_manage');
      `);
      const migration = readFileSync(
        new URL("../drizzle/0016_solid_mastermind.sql", import.meta.url),
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await legacy.exec(statement);
      }
      const tokens = await legacy.query<{
        kind: string;
        identity_email: string | null;
      }>(`SELECT "kind", "identity_email" FROM "auth_tokens" ORDER BY "kind"`);
      expect(tokens.rows).toEqual([
        { kind: "client_manage", identity_email: null },
        { kind: "email_verify", identity_email: "legacy@example.test" },
        { kind: "owner_signin", identity_email: "legacy@example.test" },
      ]);
    } finally {
      await legacy.close();
    }
  });
});
