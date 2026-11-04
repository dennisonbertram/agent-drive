CREATE TABLE "device_console_limits" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	"failures" integer NOT NULL,
	CONSTRAINT "device_console_limits_counts_nonnegative" CHECK ("device_console_limits"."attempts" >= 0 AND "device_console_limits"."failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "device_console_limits" ADD CONSTRAINT "device_console_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;