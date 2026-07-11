ALTER TABLE "auth_tokens" ADD COLUMN "identity_email" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_pii_anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "pending_email" text;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "cron_checked_at" timestamp with time zone;--> statement-breakpoint
-- Bind identity capabilities created before this deployment to the address
-- they represented at migration time. New tokens always write this directly.
UPDATE "auth_tokens" AS "token"
SET "identity_email" = "owner"."email"
FROM "owners" AS "owner"
WHERE "token"."owner_id" = "owner"."id"
  AND "token"."kind" IN ('owner_signin', 'email_verify')
  AND "token"."identity_email" IS NULL;
