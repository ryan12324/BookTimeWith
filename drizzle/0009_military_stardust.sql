ALTER TABLE "email_outbox" ADD COLUMN "booking_state_key" text;--> statement-breakpoint
UPDATE "email_outbox"
SET "delivery" = 'expired',
    "last_error" = 'Superseded-state guard added during upgrade'
WHERE "booking_id" IS NOT NULL
  AND "delivery" IN ('pending', 'failed', 'processing', 'skipped');--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "calendar_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "stripe_has_manageable_subscription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "owners"
SET "stripe_has_manageable_subscription" = true
WHERE "stripe_customer_id" IS NOT NULL
  AND "plan_status" IN ('trialing', 'active', 'past_due', 'paused');
