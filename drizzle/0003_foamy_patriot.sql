CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
UPDATE "bookings" b SET "ends_at" = b."starts_at" + make_interval(mins => COALESCE(
	(SELECT s."duration_minutes" FROM "services" s WHERE s."owner_id" = b."owner_id" LIMIT 1), 50))
	WHERE b."ends_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "ends_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("owner_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE (status = 'confirmed');
