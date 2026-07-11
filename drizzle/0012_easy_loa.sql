ALTER TABLE "stripe_events" DROP CONSTRAINT "stripe_events_owner_id_owners_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "service_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "location_mode_snapshot" "location_mode";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "location_snapshot" text;--> statement-breakpoint
UPDATE "bookings" AS "booking"
SET
  "service_name_snapshot" = NULLIF(BTRIM("service"."name"), ''),
  "location_mode_snapshot" = "service"."location_mode",
  "location_snapshot" = CASE
    WHEN "service"."location_mode" = 'theirs' THEN "booking"."client_address"
    ELSE "service"."owner_address"
  END
FROM "services" AS "service"
WHERE "service"."id" = "booking"."service_id"
  AND "service"."owner_id" = "booking"."owner_id";--> statement-breakpoint
-- Foreign keys guarantee a service row, but keep upgrades resilient to any
-- pre-constraint/manual legacy data instead of failing the whole migration.
UPDATE "bookings"
SET
  "service_name_snapshot" = COALESCE("service_name_snapshot", 'Booking'),
  "location_mode_snapshot" = COALESCE("location_mode_snapshot", 'mine')
WHERE "service_name_snapshot" IS NULL
   OR "location_mode_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "service_name_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "location_mode_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;
