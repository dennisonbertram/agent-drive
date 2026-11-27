ALTER TABLE "drive_webhook_tokens" ADD COLUMN "inbox_key_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_webhook_tokens" ADD COLUMN "inbox_record_hash" text;
