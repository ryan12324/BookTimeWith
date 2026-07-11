ALTER TABLE "booking_actions" ADD COLUMN "client_timezone_intent" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_link_snapshot" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "initial_intent_hash" text;--> statement-breakpoint
-- The exact historic static link is not recoverable after a provider overwrote
-- it, but the booking's service is the safest available legacy fallback.
UPDATE "bookings" AS "booking"
SET "meeting_link_snapshot" = NULLIF(BTRIM("service"."meeting_link"), '')
FROM "services" AS "service"
WHERE "service"."id" = "booking"."service_id"
  AND "service"."owner_id" = "booking"."owner_id";--> statement-breakpoint
-- Rows already disconnected under the old implementation can still contain a
-- provider-generated URL even though calendar_provider is null.
UPDATE "bookings"
SET "meeting_link" = "meeting_link_snapshot"
WHERE "calendar_provider" IS NULL;--> statement-breakpoint
-- Revisit every still-relevant durable mail intent once under the cutoff-free
-- recovery worker introduced with this migration.
UPDATE "bookings"
SET "mail_recovery_checked_at" = NULL
WHERE "ends_at" > now();--> statement-breakpoint
UPDATE "booking_actions" AS "action"
SET "mail_recovery_checked_at" = NULL
FROM "bookings" AS "booking"
WHERE "booking"."last_action_key" = "action"."action_key"
  AND "booking"."ends_at" > now();
