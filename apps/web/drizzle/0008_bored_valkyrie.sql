ALTER TABLE "deletion_jobs" ADD COLUMN "identity_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_jobs" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_jobs" ADD COLUMN "last_swept_at" timestamp with time zone;