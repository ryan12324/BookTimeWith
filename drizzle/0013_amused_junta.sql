ALTER TABLE "email_outbox" ADD COLUMN "auth_token_id" uuid;--> statement-breakpoint
UPDATE "email_outbox"
SET
  "delivery" = 'expired',
  "last_error" = 'Authentication mail predates exact token guards',
  "html" = '',
  "attachments" = NULL
WHERE "template" IN ('owner-sign-in', 'owner-verify-email')
  AND "auth_token_id" IS NULL
  AND "delivery" IN ('pending', 'failed', 'processing', 'skipped');
