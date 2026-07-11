ALTER TABLE "email_outbox" ADD COLUMN "owner_recipient_version" integer;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "owner_state_key" text;--> statement-breakpoint
UPDATE "email_outbox" AS "mail"
SET
  "delivery" = 'expired',
  "last_error" = 'The owner email changed before identity guards were installed',
  "html" = '',
  "attachments" = NULL
FROM "owners" AS "owner"
WHERE "mail"."owner_id" = "owner"."id"
  AND "mail"."template" IN (
    'client-confirmation', 'client-owner-changed', 'client-reminder',
    'welcome', 'owner-new-booking',
    'owner-client-changed', 'owner-morning-summary', 'trial-ending',
    'receipt', 'payment-failed', 'cancelled'
  )
  AND COALESCE("mail"."reply_to", "mail"."to_email") <> "owner"."email"
  AND "mail"."delivery" IN ('pending', 'failed', 'processing', 'skipped');--> statement-breakpoint
UPDATE "email_outbox" AS "mail"
SET "owner_recipient_version" = "owner"."session_version"
FROM "owners" AS "owner"
WHERE "mail"."owner_id" = "owner"."id"
  AND COALESCE("mail"."reply_to", "mail"."to_email") = "owner"."email"
  AND "mail"."template" IN (
    'client-confirmation', 'client-owner-changed', 'client-reminder',
    'welcome', 'owner-new-booking',
    'owner-client-changed', 'owner-morning-summary', 'trial-ending',
    'receipt', 'payment-failed', 'cancelled'
  );--> statement-breakpoint
UPDATE "email_outbox"
SET
  "delivery" = 'expired',
  "last_error" = 'Authentication mail predates exact token guards',
  "html" = '',
  "attachments" = NULL
WHERE "template" IN ('owner-sign-in', 'owner-verify-email')
  AND "delivery" IN ('pending', 'failed', 'processing', 'skipped');--> statement-breakpoint
UPDATE "email_outbox"
SET
  "delivery" = 'expired',
  "last_error" = 'State-sensitive owner mail predates delivery guards',
  "html" = '',
  "attachments" = NULL
WHERE "template" IN (
  'owner-morning-summary', 'trial-ending', 'payment-failed', 'cancelled'
)
  AND "delivery" IN ('pending', 'failed', 'processing', 'skipped');
