ALTER TABLE "owners" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "stripe_checkout_attempt_id" text;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "stripe_checkout_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");