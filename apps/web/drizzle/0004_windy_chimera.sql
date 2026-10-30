CREATE TABLE "api_key_rate_limits" (
	"api_key_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"requests" integer NOT NULL,
	CONSTRAINT "api_key_rate_limits_requests_positive" CHECK ("api_key_rate_limits"."requests" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"spend_cap_cents" bigint,
	"alert_threshold_cents" bigint,
	"alert_email" text,
	"stripe_event_created" bigint DEFAULT 0 NOT NULL,
	"stripe_event_id" text,
	"checkout_idempotency_key" text,
	"checkout_session_id" text,
	"checkout_created_at" timestamp with time zone,
	CONSTRAINT "billing_accounts_plan_check" CHECK ("billing_accounts"."plan" IN ('free', 'developer', 'team')),
	CONSTRAINT "billing_accounts_spend_cap_nonnegative" CHECK ("billing_accounts"."spend_cap_cents" IS NULL OR "billing_accounts"."spend_cap_cents" >= 0),
	CONSTRAINT "billing_accounts_alert_threshold_nonnegative" CHECK ("billing_accounts"."alert_threshold_cents" IS NULL OR "billing_accounts"."alert_threshold_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_egress_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid,
	"drive_id" uuid,
	"object_key" text NOT NULL,
	"bytes_sent" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_egress_bytes_nonnegative" CHECK ("billing_egress_events"."bytes_sent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_log_objects" (
	"object_key" text NOT NULL,
	"etag" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_log_objects_pk" PRIMARY KEY("object_key","etag")
);
--> statement-breakpoint
CREATE TABLE "billing_meter_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "billing_meter_reports_cents_positive" CHECK ("billing_meter_reports"."cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"threshold_cents" bigint NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "billing_notifications_threshold_nonnegative" CHECK ("billing_notifications"."threshold_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"account_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"plan" text NOT NULL,
	"peak_drives" bigint DEFAULT 0 NOT NULL,
	"peak_storage_bytes" bigint DEFAULT 0 NOT NULL,
	"authorized_egress_bytes" bigint DEFAULT 0 NOT NULL,
	"baseline_cents" bigint DEFAULT 0 NOT NULL,
	"earned_cents" bigint DEFAULT 0 NOT NULL,
	"base_cents" bigint DEFAULT 0 NOT NULL,
	"rates" jsonb,
	"statement" jsonb,
	CONSTRAINT "billing_periods_pk" PRIMARY KEY("account_id","period_start"),
	CONSTRAINT "billing_periods_plan_check" CHECK ("billing_periods"."plan" IN ('free', 'developer', 'team')),
	CONSTRAINT "billing_periods_peak_drives_nonnegative" CHECK ("billing_periods"."peak_drives" >= 0),
	CONSTRAINT "billing_periods_peak_storage_nonnegative" CHECK ("billing_periods"."peak_storage_bytes" >= 0),
	CONSTRAINT "billing_periods_authorized_egress_nonnegative" CHECK ("billing_periods"."authorized_egress_bytes" >= 0),
	CONSTRAINT "billing_periods_baseline_nonnegative" CHECK ("billing_periods"."baseline_cents" >= 0),
	CONSTRAINT "billing_periods_earned_nonnegative" CHECK ("billing_periods"."earned_cents" >= 0),
	CONSTRAINT "billing_periods_base_nonnegative" CHECK ("billing_periods"."base_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_rate_limits" ADD CONSTRAINT "api_key_rate_limits_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_egress_events" ADD CONSTRAINT "billing_egress_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_egress_events" ADD CONSTRAINT "billing_egress_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_egress_events" ADD CONSTRAINT "billing_egress_events_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_meter_reports" ADD CONSTRAINT "billing_meter_reports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notifications" ADD CONSTRAINT "billing_notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_stripe_customer_unique" ON "billing_accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_stripe_subscription_unique" ON "billing_accounts" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_egress_account_time_idx" ON "billing_egress_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_egress_agent_time_idx" ON "billing_egress_events" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_meter_reports_pending_idx" ON "billing_meter_reports" USING btree ("lease_until","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_notifications_account_period_threshold_unique" ON "billing_notifications" USING btree ("account_id","period_start","threshold_cents");--> statement-breakpoint
CREATE INDEX "billing_notifications_pending_idx" ON "billing_notifications" USING btree ("lease_until","created_at");