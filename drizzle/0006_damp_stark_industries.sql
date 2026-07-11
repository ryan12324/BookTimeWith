ALTER TABLE "bookings" ADD COLUMN "client_timezone" text;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;