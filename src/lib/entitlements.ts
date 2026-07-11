type EntitledOwner = {
  planStatus: "trialing" | "active" | "past_due" | "paused" | "cancelled";
  trialEndsAt: Date | null;
  graceUntil: Date | null;
  accessEndsAt: Date | null;
  emailVerifiedAt: Date | null;
};

/** Central booking entitlement, independent of whether scheduled maintenance ran. */
export function bookingEntitlement(owner: EntitledOwner, now = new Date()) {
  // A public page must not collect client details until its owner has proved
  // possession of the notification/sign-in address.
  if (!owner.emailVerifiedAt) {
    return { allowed: false, reason: "email_unverified" } as const;
  }
  switch (owner.planStatus) {
    case "active":
      return { allowed: true, reason: null } as const;
    case "trialing":
      return owner.trialEndsAt && owner.trialEndsAt > now
        ? ({ allowed: true, reason: null } as const)
        : ({ allowed: false, reason: "trial_expired" } as const);
    case "past_due":
      return owner.graceUntil && owner.graceUntil > now
        ? ({ allowed: true, reason: null } as const)
        : ({ allowed: false, reason: "payment_grace_expired" } as const);
    case "cancelled":
      return owner.accessEndsAt && owner.accessEndsAt > now
        ? ({ allowed: true, reason: null } as const)
        : ({ allowed: false, reason: "subscription_ended" } as const);
    case "paused":
      return { allowed: false, reason: "paused" } as const;
  }
}

export const canAcceptBookings = (owner: EntitledOwner, now = new Date()) =>
  bookingEntitlement(owner, now).allowed;
