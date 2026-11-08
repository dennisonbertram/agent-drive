CREATE TABLE "drive_trace_inboxes" (
	"drive_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"wrapped_private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_webhook_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_trace_inboxes" ADD CONSTRAINT "drive_trace_inboxes_drive_account_fk" FOREIGN KEY ("drive_id","account_id") REFERENCES "public"."drives"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_webhook_tokens" ADD CONSTRAINT "drive_webhook_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_webhook_tokens" ADD CONSTRAINT "drive_webhook_tokens_drive_account_fk" FOREIGN KEY ("drive_id","account_id") REFERENCES "public"."drives"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_webhook_tokens_token_hash_unique" ON "drive_webhook_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_webhook_tokens_active_drive_unique" ON "drive_webhook_tokens" USING btree ("drive_id") WHERE "drive_webhook_tokens"."revoked_at" IS NULL;