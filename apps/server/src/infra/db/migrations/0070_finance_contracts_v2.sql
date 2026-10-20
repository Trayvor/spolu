CREATE TABLE "finance_contract_documents" (
	"document_id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"amount_minor" bigint,
	"paid_on" date,
	CONSTRAINT "finance_contract_documents_payment_check" CHECK (("finance_contract_documents"."amount_minor" is null) = ("finance_contract_documents"."paid_on" is null)
        and ("finance_contract_documents"."amount_minor" is null or "finance_contract_documents"."amount_minor" >= 0)),
	CONSTRAINT "finance_contract_documents_self_check" CHECK ("finance_contract_documents"."document_id" <> "finance_contract_documents"."contract_id")
);
--> statement-breakpoint
CREATE TABLE "finance_contract_schedules" (
	"item_id" text PRIMARY KEY NOT NULL,
	"frequency" text NOT NULL,
	"every_months" integer,
	"amount_minor" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"dates" date[],
	CONSTRAINT "finance_contract_schedules_frequency_check" CHECK ("finance_contract_schedules"."frequency" in ('monthly', 'quarterly', 'semiannual', 'yearly', 'everyMonths', 'dates')),
	CONSTRAINT "finance_contract_schedules_shape_check" CHECK (case when "finance_contract_schedules"."frequency" = 'dates'
        then "finance_contract_schedules"."dates" is not null and cardinality("finance_contract_schedules"."dates") between 1 and 120
          and "finance_contract_schedules"."every_months" is null
        else "finance_contract_schedules"."dates" is null and "finance_contract_schedules"."every_months" is not null
          and "finance_contract_schedules"."every_months" between 1 and 120
        end),
	CONSTRAINT "finance_contract_schedules_amount_check" CHECK ("finance_contract_schedules"."amount_minor" >= 0),
	CONSTRAINT "finance_contract_schedules_period_check" CHECK ("finance_contract_schedules"."ends_on" is null or "finance_contract_schedules"."ends_on" >= "finance_contract_schedules"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "finance_contract_shares" DROP CONSTRAINT "finance_contract_shares_amount_check";--> statement-breakpoint
ALTER TABLE "finance_items" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "finance_contract_documents" ADD CONSTRAINT "finance_contract_documents_document_id_finance_items_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_contract_documents" ADD CONSTRAINT "finance_contract_documents_contract_id_finance_items_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_contract_schedules" ADD CONSTRAINT "finance_contract_schedules_item_id_finance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_contract_documents_contract_idx" ON "finance_contract_documents" USING btree ("contract_id","paid_on");--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_parent_id_finance_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_items_parent_idx" ON "finance_items" USING btree ("parent_id") WHERE "finance_items"."parent_id" is not null;--> statement-breakpoint
ALTER TABLE "finance_contract_shares" ADD CONSTRAINT "finance_contract_shares_amount_check" CHECK ("finance_contract_shares"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_parent_check" CHECK ("finance_items"."parent_id" is null or ("finance_items"."type" = 'contract' and "finance_items"."parent_id" <> "finance_items"."id"));