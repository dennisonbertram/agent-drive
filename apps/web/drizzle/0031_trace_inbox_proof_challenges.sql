CREATE TABLE "drive_trace_inbox_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"inbox_record_hash" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_trace_inbox_challenges_action_check" CHECK ("drive_trace_inbox_challenges"."action" IN ('enroll', 'issue-token'))
);
--> statement-breakpoint
ALTER TABLE "drive_trace_inbox_challenges" ADD CONSTRAINT "drive_trace_inbox_challenges_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_trace_inbox_challenges_actor_action_unique" ON "drive_trace_inbox_challenges" USING btree ("drive_id","actor_user_id","action");--> statement-breakpoint
CREATE INDEX "drive_trace_inbox_challenges_expiry_idx" ON "drive_trace_inbox_challenges" USING btree ("expires_at");