CREATE TABLE "console_user_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_user_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"lease_until" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"billing_closed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "deletion_jobs_kind_check" CHECK ("deletion_jobs"."kind" IN ('drive', 'account'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "deleting_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "console_user_tombstones_hash_unique" ON "console_user_tombstones" USING btree ("external_user_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_jobs_kind_target_unique" ON "deletion_jobs" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "deletion_jobs_claim_idx" ON "deletion_jobs" USING btree ("completed_at","not_before","lease_until");