ALTER TABLE "bookings" ADD COLUMN "manage_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "bookings" AS "booking"
SET "manage_expires_at" = COALESCE(
  (
    SELECT MAX("token"."expires_at")
    FROM "auth_tokens" AS "token"
    WHERE "token"."booking_id" = "booking"."id"
      AND "token"."kind" = 'client_manage'
  ),
  "booking"."ends_at"
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "manage_expires_at" SET NOT NULL;
