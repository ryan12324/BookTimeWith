import path from "node:path";
import { createElement } from "react";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../src/db/schema";
import {
  bookingMailStateKey,
  deliverQueuedEmail,
  ownerBillingMailStateKey,
  sendVerification,
  spool,
} from "../src/emails/send";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const SERVICE_ID = "00000000-0000-4000-8000-000000000011";
const BOOKING_ID = "00000000-0000-4000-8000-000000000021";
const NOW = new Date("2026-07-11T12:00:00Z");

describe("outbox delivery guards", () => {
  const pg = new PGlite({ extensions: { btree_gist } });
  const db = drizzle(pg, { schema });

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  });

  beforeEach(async () => {
    await db.delete(schema.emailLog);
    await db.delete(schema.emailOutbox);
    await db.delete(schema.authTokens);
    await db.delete(schema.bookings);
    await db.delete(schema.services);
    await db.delete(schema.owners);
    await db.insert(schema.owners).values({
      id: OWNER_ID,
      email: "owner@example.test",
      emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
      name: "Dana Owner",
      handle: "dana-owner",
      sessionVersion: 4,
      planStatus: "active",
      stripeSubscriptionId: "sub_current",
      stripeHasManageableSubscription: true,
    });
    vi.stubEnv("EMAIL_WEBHOOK_URL", "https://mail.example.test/send");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 202 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await pg.close();
  });

  const queue = async (
    values: Partial<typeof schema.emailOutbox.$inferInsert> & {
      id: string;
      toEmail: string;
      template: string;
    },
  ) => {
    await db.insert(schema.emailOutbox).values({
      fromLine: "booktimewith.com",
      subject: "Test message",
      html: "<p>test</p>",
      delivery: "pending",
      nextAttemptAt: new Date(NOW.getTime() - 1_000),
      createdAt: new Date(NOW.getTime() - 60_000),
      ...values,
    });
  };

  it("delivers only when the exact embedded auth token is unused and unexpired", async () => {
    const cases = [
      {
        label: "unused",
        tokenId: "00000000-0000-4000-8000-000000000101",
        token: { expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null },
        delivered: true,
      },
      {
        label: "deleted",
        tokenId: "00000000-0000-4000-8000-000000000102",
        token: null,
        delivered: false,
      },
      {
        label: "used",
        tokenId: "00000000-0000-4000-8000-000000000103",
        token: {
          expiresAt: new Date(NOW.getTime() + 60_000),
          usedAt: new Date(NOW.getTime() - 1_000),
        },
        delivered: false,
      },
      {
        label: "expired",
        tokenId: "00000000-0000-4000-8000-000000000104",
        token: { expiresAt: NOW, usedAt: null },
        delivered: false,
      },
    ] as const;

    for (const candidate of cases) {
      if (candidate.token) {
        await db.insert(schema.authTokens).values({
          id: candidate.tokenId,
          kind: "owner_signin",
          ownerId: OWNER_ID,
          identityEmail: "owner@example.test",
          tokenHash: `hash-${candidate.label}`,
          expiresAt: candidate.token.expiresAt,
          usedAt: candidate.token.usedAt,
        });
      }
      const outboxId = `00000000-0000-4000-8000-0000000002${cases.indexOf(candidate) + 1}0`;
      await queue({
        id: outboxId,
        ownerId: OWNER_ID,
        ownerRecipientVersion: 4,
        authTokenId: candidate.tokenId,
        toEmail: "owner@example.test",
        template: "owner-sign-in",
      });

      await expect(deliverQueuedEmail(db, outboxId, NOW)).resolves.toBe(
        candidate.delivered,
      );
      const row = await db.query.emailOutbox.findFirst({
        where: (outbox, { eq }) => eq(outbox.id, outboxId),
      });
      expect(row?.delivery, candidate.label).toBe(
        candidate.delivered ? "delivered" : "expired",
      );
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("guards an owner recipient by To and a client message by Reply-To", async () => {
    const cases = [
      {
        id: "00000000-0000-4000-8000-000000000301",
        toEmail: "owner@example.test",
        replyTo: null,
        expected: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000302",
        toEmail: "old-owner@example.test",
        replyTo: null,
        expected: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000303",
        toEmail: "client@example.test",
        replyTo: "owner@example.test",
        expected: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000304",
        toEmail: "client@example.test",
        replyTo: "old-owner@example.test",
        expected: false,
      },
    ] as const;

    for (const candidate of cases) {
      await queue({
        id: candidate.id,
        ownerId: OWNER_ID,
        ownerRecipientVersion: 4,
        toEmail: candidate.toEmail,
        replyTo: candidate.replyTo,
        template: candidate.replyTo ? "client-reminder" : "welcome",
      });
      await expect(deliverQueuedEmail(db, candidate.id, NOW)).resolves.toBe(
        candidate.expected,
      );
    }

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("binds verification delivery to the exact pending address", async () => {
    await db
      .update(schema.owners)
      .set({ pendingEmail: "pending@example.test" })
      .where(eq(schema.owners.id, OWNER_ID));
    const owner = await db.query.owners.findFirst({
      where: (row, { eq }) => eq(row.id, OWNER_ID),
    });
    const queuedId = await sendVerification(
      db,
      owner!,
      "https://booktimewith.com",
      { deferDelivery: true },
    );
    expect(queuedId).toEqual(expect.any(String));
    const row = await db.query.emailOutbox.findFirst({
      where: (outbox, { eq }) => eq(outbox.id, queuedId as string),
    });
    const token = await db.query.authTokens.findFirst({
      where: (authToken, { eq }) => eq(authToken.id, row!.authTokenId!),
    });
    expect(row?.toEmail).toBe("pending@example.test");
    expect(token?.identityEmail).toBe("pending@example.test");
    await expect(
      deliverQueuedEmail(db, queuedId as string, new Date(Date.now() + 1_000)),
    ).resolves.toBe(true);
  });

  it("holds non-auth mail until the owner has proved the recipient address", async () => {
    await db
      .update(schema.owners)
      .set({ emailVerifiedAt: null })
      .where(eq(schema.owners.id, OWNER_ID));
    const outboxId = "00000000-0000-4000-8000-000000000305";
    await queue({
      id: outboxId,
      ownerId: OWNER_ID,
      ownerRecipientVersion: 4,
      toEmail: "client@example.test",
      replyTo: "owner@example.test",
      template: "client-confirmation",
    });

    await expect(deliverQueuedEmail(db, outboxId, NOW)).resolves.toBe(false);
    const row = await db.query.emailOutbox.findFirst({
      where: (outbox, { eq }) => eq(outbox.id, outboxId),
    });
    expect(row).toMatchObject({
      delivery: "pending",
      lastError: "Waiting for the owner email to be verified",
    });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("expires owner-state mail after the billing aggregate changes", async () => {
    await queue({
      id: "00000000-0000-4000-8000-000000000401",
      ownerId: OWNER_ID,
      ownerRecipientVersion: 4,
      ownerStateKey: ownerBillingMailStateKey({
        planStatus: "past_due",
        stripeSubscriptionId: "sub_old",
        stripeHasManageableSubscription: true,
        trialEndsAt: null,
        accessEndsAt: null,
        graceUntil: new Date("2026-07-20T12:00:00Z"),
      }),
      toEmail: "owner@example.test",
      template: "payment-failed",
    });

    await expect(
      deliverQueuedEmail(db, "00000000-0000-4000-8000-000000000401", NOW),
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("expires booking mail when calendar reconciliation changes the meeting link", async () => {
    await db.insert(schema.services).values({
      id: SERVICE_ID,
      ownerId: OWNER_ID,
      name: "Consultation",
      durationMinutes: 60,
    });
    const startsAt = new Date("2026-08-12T09:00:00Z");
    const endsAt = new Date("2026-08-12T10:00:00Z");
    await db.insert(schema.bookings).values({
      id: BOOKING_ID,
      ownerId: OWNER_ID,
      serviceId: SERVICE_ID,
      startsAt,
      endsAt,
      manageExpiresAt: endsAt,
      serviceNameSnapshot: "Consultation",
      locationModeSnapshot: "mine",
      clientName: "Alex Client",
      clientEmail: "client@example.test",
      meetingLink: "https://meet.example.test/current",
    });
    await queue({
      id: "00000000-0000-4000-8000-000000000402",
      ownerId: OWNER_ID,
      ownerRecipientVersion: 4,
      bookingId: BOOKING_ID,
      bookingStateKey: bookingMailStateKey({
        startsAt,
        lastActionKey: null,
        meetingLink: "https://meet.example.test/old",
      }),
      toEmail: "client@example.test",
      replyTo: "owner@example.test",
      template: "client-reminder",
    });

    await expect(
      deliverQueuedEmail(db, "00000000-0000-4000-8000-000000000402", NOW),
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reactivates an expired deduplicated row with freshly rendered state", async () => {
    const outboxId = "00000000-0000-4000-8000-000000000501";
    await queue({
      id: outboxId,
      dedupeKey: "recover:booking-123",
      toEmail: "old@example.test",
      template: "client-confirmation",
      delivery: "expired",
      html: "",
    });

    await expect(
      spool(
        db,
        {
          to: "client@example.test",
          from: "Dana via booktimewith.com",
          subject: "Fresh confirmation",
          template: "client-confirmation",
          dedupeKey: "recover:booking-123",
          element: createElement("p", null, "Fresh booking state"),
        },
        { deferDelivery: true },
      ),
    ).resolves.toBe(outboxId);

    const revived = await db.query.emailOutbox.findFirst({
      where: (outbox, { eq }) => eq(outbox.id, outboxId),
    });
    expect(revived).toMatchObject({
      delivery: "pending",
      toEmail: "client@example.test",
      subject: "Fresh confirmation",
      attempts: 0,
      lastError: null,
    });
    expect(revived?.html).toContain("Fresh booking state");
  });
});
