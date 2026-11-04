CREATE TABLE "device_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_name" text NOT NULL,
	"machine" text,
	"public_key" text NOT NULL,
	"ip_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"account_id" uuid,
	"agent_id" uuid,
	"drive_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"new_drive_id" uuid,
	"sealed_drive_keys" jsonb,
	"api_key_id" uuid,
	"interval_seconds" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "device_authorizations_status_check" CHECK ("device_authorizations"."status" IN ('pending', 'approved', 'denied', 'consumed'))
);
--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_authorizations_device_code_hash_unique" ON "device_authorizations" USING btree ("device_code_hash");--> statement-breakpoint
CREATE INDEX "device_authorizations_user_code_idx" ON "device_authorizations" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "device_authorizations_ip_created_idx" ON "device_authorizations" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "device_authorizations_created_idx" ON "device_authorizations" USING btree ("created_at");