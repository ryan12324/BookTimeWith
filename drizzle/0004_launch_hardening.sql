ALTER TABLE "owners" ADD COLUMN "currency" text DEFAULT 'GBP' NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "access_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_request_key" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_provider" "calendar_provider";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_sync_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_sync_error" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_client_request_key_uniq" ON "bookings" USING btree ("client_request_key") WHERE "client_request_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_calendar_sync_status_idx" ON "bookings" USING btree ("calendar_sync_status");--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "sync_status" text DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ALTER COLUMN "delivery" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key_uniq" ON "email_outbox" USING btree ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_retry_due_idx" ON "email_outbox" USING btree ("delivery","next_attempt_at");--> statement-breakpoint
CREATE TABLE "booking_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"action_key" text NOT NULL,
	"action" text NOT NULL,
	"actor" "booking_actor" NOT NULL,
	"reason" text,
	"from_starts_at" timestamp with time zone,
	"to_starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_actions_action_key_unique" UNIQUE("action_key")
);--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"type" text NOT NULL,
	"event_created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text
);--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "booking_actions" ADD CONSTRAINT "booking_actions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_actions" ADD CONSTRAINT "booking_actions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "stripe_events_owner_created_idx" ON "stripe_events" USING btree ("owner_id","event_created_at");--> statement-breakpoint
CREATE INDEX "rate_limits_updated_at_idx" ON "rate_limits" USING btree ("updated_at");
