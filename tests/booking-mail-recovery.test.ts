import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";

const mailMocks = vi.hoisted(() => ({
  clientConfirmationDedupeKey: vi.fn(
    (bookingId: string, _startsAt: Date, actionKey?: string) =>
      `client-confirmation:${bookingId}:${actionKey ?? "initial"}`,
  ),
  clientOwnerChangedDedupeKey: vi.fn(
    (bookingId: string, kind: string, actionKey: string) =>
      `client-owner:${bookingId}:${kind}:${actionKey}`,
  ),
  ownerClientChangedDedupeKey: vi.fn(
    (bookingId: string, kind: string, actionKey: string) =>
      `owner-client:${bookingId}:${kind}:${actionKey}`,
  ),
  ownerNewBookingDedupeKey: vi.fn(
    (bookingId: string) => `owner-new:${bookingId}`,
  ),
  sendBookingEmails: vi.fn(),
  sendClientBookingConfirmation: vi.fn(),
  sendClientOwnerChanged: vi.fn(),
  sendOwnerClientChanged: vi.fn(),
}));

const repoMocks = vi.hoisted(() => ({
  mintManageToken: vi.fn(),
}));

vi.mock("@/emails/send", () => mailMocks);
vi.mock("@/db/repo", () => repoMocks);

import { recoverMissingBookingMail } from "../src/lib/booking-mail-recovery";

interface TestOwner {
  id: string;
  notifyOnChange: boolean;
  emailVerifiedAt: Date | null;
}

interface TestBooking {
  id: string;
  ownerId: string;
  status: "confirmed" | "cancelled";
  calendarSyncStatus: string;
  startsAt: Date;
  endsAt: Date;
  lastActionKey: string | null;
  mailRecoveryCheckedAt: Date | null;
  createdAt: Date;
}

interface TestAction {
  id: string;
  bookingId: string;
  ownerId: string;
  actionKey: string;
  action: "move" | "cancel" | "restore";
  actor: "client" | "owner";
  fromStartsAt: Date | null;
  reason: string | null;
  mailRecoveryCheckedAt: Date | null;
  createdAt: Date;
}

interface QueryOptions {
  where?: unknown;
  orderBy?: unknown;
  limit?: number;
}

function references(
  value: unknown,
  target: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (value === target) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some((key) => {
    try {
      return references(Reflect.get(value, key), target, seen);
    } catch {
      return false;
    }
  });
}

function stringValues(
  value: unknown,
  seen = new WeakSet<object>(),
): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Reflect.ownKeys(value).flatMap((key) => {
    try {
      return stringValues(Reflect.get(value, key), seen);
    } catch {
      return [];
    }
  });
}

function usesRecoveryCursor(
  options: QueryOptions,
  table: unknown,
  recoveryColumn: unknown,
) {
  const expression =
    typeof options.orderBy === "function"
      ? options.orderBy(table, { asc: (column: unknown) => ({ column }) })
      : options.orderBy;
  return references(expression, recoveryColumn);
}

function orderCandidates<
  T extends {
    createdAt: Date;
    mailRecoveryCheckedAt: Date | null;
  },
>(rows: T[], rotate: boolean) {
  return [...rows].sort((left, right) => {
    if (rotate) {
      const leftChecked = left.mailRecoveryCheckedAt?.getTime() ?? null;
      const rightChecked = right.mailRecoveryCheckedAt?.getTime() ?? null;
      if (leftChecked === null && rightChecked !== null) return -1;
      if (leftChecked !== null && rightChecked === null) return 1;
      if (leftChecked !== null && rightChecked !== null) {
        const checkedDifference = leftChecked - rightChecked;
        if (checkedDifference !== 0) return checkedDifference;
      }
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

function makeDb(input: {
  initialBookings?: TestBooking[];
  actionBookings?: TestBooking[];
  owners: TestOwner[];
  actions?: TestAction[];
  queuedKeys?: string[];
}) {
  const initialBookings = input.initialBookings ?? [];
  const allBookings = new Map(
    [...initialBookings, ...(input.actionBookings ?? [])].map((booking) => [
      booking.id,
      booking,
    ]),
  );
  const owners = new Map(input.owners.map((owner) => [owner.id, owner]));
  const actions = input.actions ?? [];
  const queuedKeys = new Set(input.queuedKeys ?? []);

  const findConditionValue = (where: unknown, candidates: Iterable<string>) => {
    const values = new Set(stringValues(where));
    return Array.from(candidates).find((candidate) => values.has(candidate));
  };

  const db = {
    query: {
      bookings: {
        findMany: vi.fn(async (options: QueryOptions) => {
          const rotate = usesRecoveryCursor(
            options,
            schema.bookings,
            schema.bookings.mailRecoveryCheckedAt,
          );
          return orderCandidates(initialBookings, rotate).slice(
            0,
            options.limit,
          );
        }),
        findFirst: vi.fn(async (options: QueryOptions) => {
          const id = findConditionValue(options.where, allBookings.keys());
          return id ? allBookings.get(id) : undefined;
        }),
      },
      bookingActions: {
        findMany: vi.fn(async (options: QueryOptions) => {
          const rotate = usesRecoveryCursor(
            options,
            schema.bookingActions,
            schema.bookingActions.mailRecoveryCheckedAt,
          );
          return orderCandidates(actions, rotate).slice(0, options.limit);
        }),
      },
      owners: {
        findFirst: vi.fn(async (options: QueryOptions) => {
          const id = findConditionValue(options.where, owners.keys());
          return id ? owners.get(id) : undefined;
        }),
      },
      emailOutbox: {
        findFirst: vi.fn(async (options: QueryOptions) => {
          const key = findConditionValue(options.where, queuedKeys);
          return key ? { delivery: "delivered" } : undefined;
        }),
      },
    },
    update: vi.fn((table: unknown) => ({
      set: (values: { mailRecoveryCheckedAt: Date }) => ({
        where: async (where: unknown) => {
          if (table === schema.bookings) {
            const id = findConditionValue(where, allBookings.keys());
            if (id) allBookings.get(id)!.mailRecoveryCheckedAt = values.mailRecoveryCheckedAt;
          }
          if (table === schema.bookingActions) {
            const id = findConditionValue(
              where,
              actions.map((action) => action.id),
            );
            const action = actions.find((candidate) => candidate.id === id);
            if (action) action.mailRecoveryCheckedAt = values.mailRecoveryCheckedAt;
          }
        },
      }),
    })),
  };

  return db as unknown as Parameters<typeof recoverMissingBookingMail>[0];
}

function booking(index: number, checkedAt: Date | null = null): TestBooking {
  return {
    id: `booking-${index}`,
    ownerId: "owner-1",
    status: "confirmed",
    calendarSyncStatus: "synced",
    startsAt: new Date(`2026-07-12T${String(index).padStart(2, "0")}:00:00Z`),
    endsAt: new Date("2099-07-12T12:00:00Z"),
    lastActionKey: null,
    mailRecoveryCheckedAt: checkedAt,
    createdAt: new Date(`2026-07-11T${String(index).padStart(2, "0")}:00:00Z`),
  };
}

describe("booking mail recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMocks.mintManageToken.mockResolvedValue("manage-token");
    mailMocks.sendBookingEmails.mockResolvedValue(undefined);
    mailMocks.sendClientBookingConfirmation.mockResolvedValue("client-mail");
    mailMocks.sendClientOwnerChanged.mockResolvedValue("client-change-mail");
    mailMocks.sendOwnerClientChanged.mockImplementation(
      async (_db, options: { owner: TestOwner }) =>
        options.owner.notifyOnChange && options.owner.emailVerifiedAt
          ? "owner-change-mail"
          : false,
    );
  });

  it("rotates a bounded scan so missing mail beyond the first candidate window is recovered", async () => {
    const candidates = Array.from({ length: 11 }, (_, index) =>
      booking(index + 1),
    );
    const queuedKeys = candidates.slice(0, 10).map((candidate) =>
      mailMocks.clientConfirmationDedupeKey(
        candidate.id,
        candidate.startsAt,
      ),
    );
    mailMocks.clientConfirmationDedupeKey.mockClear();
    const db = makeDb({
      initialBookings: candidates,
      owners: [
        { id: "owner-1", notifyOnChange: false, emailVerifiedAt: null },
      ],
      queuedKeys,
    });
    const now = new Date("2026-07-12T12:00:00Z");

    await expect(
      recoverMissingBookingMail(db, "https://booktimewith.test", now, 1),
    ).resolves.toEqual({ inspected: 10, recovered: 0 });
    await expect(
      recoverMissingBookingMail(db, "https://booktimewith.test", now, 1),
    ).resolves.toEqual({ inspected: 1, recovered: 1 });

    expect(mailMocks.sendBookingEmails).toHaveBeenCalledTimes(1);
    expect(mailMocks.sendBookingEmails).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        booking: expect.objectContaining({ id: "booking-11" }),
      }),
    );
  });

  it("does not let disabled or unverified owner notifications consume the recovery cap", async () => {
    const start = new Date("2026-07-13T10:00:00Z");
    const actionBookings: TestBooking[] = [
      {
        ...booking(1),
        ownerId: "owner-disabled",
        lastActionKey: "action-disabled",
      },
      {
        ...booking(2),
        ownerId: "owner-unverified",
        lastActionKey: "action-unverified",
      },
      {
        ...booking(3),
        ownerId: "owner-enabled",
        lastActionKey: "action-client-mail",
      },
    ];
    const actions: TestAction[] = [
      {
        id: "ledger-disabled",
        bookingId: "booking-1",
        ownerId: "owner-disabled",
        actionKey: "action-disabled",
        action: "cancel",
        actor: "client",
        fromStartsAt: start,
        reason: null,
        mailRecoveryCheckedAt: null,
        createdAt: new Date("2026-07-11T08:00:00Z"),
      },
      {
        id: "ledger-unverified",
        bookingId: "booking-2",
        ownerId: "owner-unverified",
        actionKey: "action-unverified",
        action: "cancel",
        actor: "client",
        fromStartsAt: start,
        reason: null,
        mailRecoveryCheckedAt: null,
        createdAt: new Date("2026-07-11T09:00:00Z"),
      },
      {
        id: "ledger-client-mail",
        bookingId: "booking-3",
        ownerId: "owner-enabled",
        actionKey: "action-client-mail",
        action: "cancel",
        actor: "owner",
        fromStartsAt: start,
        reason: null,
        mailRecoveryCheckedAt: null,
        createdAt: new Date("2026-07-11T10:00:00Z"),
      },
    ];
    const db = makeDb({
      actionBookings,
      actions,
      owners: [
        {
          id: "owner-disabled",
          notifyOnChange: false,
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
        {
          id: "owner-unverified",
          notifyOnChange: true,
          emailVerifiedAt: null,
        },
        {
          id: "owner-enabled",
          notifyOnChange: true,
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
    });

    await expect(
      recoverMissingBookingMail(
        db,
        "https://booktimewith.test",
        new Date("2026-07-12T12:00:00Z"),
        1,
      ),
    ).resolves.toEqual({ inspected: 3, recovered: 1 });

    expect(mailMocks.sendOwnerClientChanged).toHaveBeenCalledTimes(2);
    expect(mailMocks.sendClientOwnerChanged).toHaveBeenCalledTimes(1);
    expect(mailMocks.sendClientOwnerChanged).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        booking: expect.objectContaining({ id: "booking-3" }),
      }),
    );
  });

  it("uses appointment relevance instead of a booking-age cutoff", async () => {
    const oldFutureBooking = {
      ...booking(1),
      createdAt: new Date("2020-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-01T00:00:00Z"),
    };
    const db = makeDb({
      initialBookings: [oldFutureBooking],
      owners: [
        { id: "owner-1", notifyOnChange: false, emailVerifiedAt: null },
      ],
    });

    await expect(
      recoverMissingBookingMail(
        db,
        "https://booktimewith.test",
        new Date("2026-07-12T12:00:00Z"),
        1,
      ),
    ).resolves.toEqual({ inspected: 1, recovered: 1 });

    const options = (db.query.bookings.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as QueryOptions;
    expect(references(options.where, schema.bookings.endsAt)).toBe(true);
    const source = readFileSync(
      new URL("../src/lib/booking-mail-recovery.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("gte(schema.bookings.createdAt");
    expect(source).not.toContain("gte(schema.bookingActions.createdAt");
  });
});
