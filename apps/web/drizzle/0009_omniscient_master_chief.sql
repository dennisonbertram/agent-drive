CREATE TABLE "deletion_billing_receipts" (
	"account_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"statement" jsonb NOT NULL,
	CONSTRAINT "deletion_billing_receipts_pk" PRIMARY KEY("account_id","period_start")
);
