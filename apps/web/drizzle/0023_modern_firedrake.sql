CREATE TABLE "console_rate_limits" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"requests" integer NOT NULL,
	CONSTRAINT "console_rate_limits_requests_positive" CHECK ("console_rate_limits"."requests" > 0)
);
--> statement-breakpoint
ALTER TABLE "console_rate_limits" ADD CONSTRAINT "console_rate_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;