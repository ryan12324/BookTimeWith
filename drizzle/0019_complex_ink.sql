ALTER TYPE "public"."location_mode" ADD VALUE 'virtual';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_link_override" text;