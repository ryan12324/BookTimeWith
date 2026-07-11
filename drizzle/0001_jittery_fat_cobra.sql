ALTER TABLE "bookings" ADD COLUMN "meeting_link" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attachments" text;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "grace_until" timestamp with time zone;