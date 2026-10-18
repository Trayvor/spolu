CREATE TABLE "finance_contract_shares" (
	"item_id" text NOT NULL,
	"group_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "finance_contract_shares_item_id_group_id_pk" PRIMARY KEY("item_id","group_id"),
	CONSTRAINT "finance_contract_shares_amount_check" CHECK ("finance_contract_shares"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_type_check";--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_title_check";--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_contract_check";--> statement-breakpoint
ALTER TABLE "finance_folders" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_items" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_sets" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_items" ADD COLUMN "payer_name" text;--> statement-breakpoint
ALTER TABLE "finance_items" ADD COLUMN "expense_kind" text;--> statement-breakpoint
ALTER TABLE "finance_items" ADD COLUMN "payee_id" text;--> statement-breakpoint
ALTER TABLE "finance_contract_shares" ADD CONSTRAINT "finance_contract_shares_item_id_finance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_contract_shares" ADD CONSTRAINT "finance_contract_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_contract_shares_group_idx" ON "finance_contract_shares" USING btree ("group_id","item_id");--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_payee_id_user_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_items_org_created_idx" ON "finance_items" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "finance_items"."group_id" is null;--> statement-breakpoint
CREATE INDEX "finance_items_expense_day_idx" ON "finance_items" USING btree ("starts_on") WHERE "finance_items"."type" = 'expense';--> statement-breakpoint
CREATE INDEX "finance_items_payee_idx" ON "finance_items" USING btree ("payee_id") WHERE "finance_items"."payee_id" is not null;--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_expense_kind_check" CHECK ("finance_items"."expense_kind" is null or "finance_items"."expense_kind" in ('salary', 'other'));--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_payer_check" CHECK ("finance_items"."payer_name" is null or char_length("finance_items"."payer_name") between 1 and 200);--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_type_check" CHECK ("finance_items"."type" in ('contract', 'document', 'note', 'expense'));--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_title_check" CHECK (char_length("finance_items"."title") <= 200 and (char_length("finance_items"."title") >= 1
        or ("finance_items"."type" = 'expense' and coalesce("finance_items"."expense_kind", '') = 'salary')));--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_contract_check" CHECK (case "finance_items"."type"
        when 'contract' then "finance_items"."amount_minor" is not null and "finance_items"."currency" is not null
          and "finance_items"."starts_on" is not null and "finance_items"."ends_on" is not null
          and "finance_items"."expense_kind" is null and "finance_items"."payee_id" is null
          and ("finance_items"."group_id" is null) = ("finance_items"."payer_name" is not null)
        when 'expense' then "finance_items"."amount_minor" is not null and "finance_items"."currency" is not null
          and "finance_items"."starts_on" is not null and "finance_items"."ends_on" is not null
          and "finance_items"."ends_on" = "finance_items"."starts_on"
          and "finance_items"."group_id" is null and "finance_items"."contract_number" is null and "finance_items"."payer_name" is null
          and "finance_items"."expense_kind" is not null
          and ("finance_items"."expense_kind" = 'salary') = ("finance_items"."payee_id" is not null)
        else "finance_items"."amount_minor" is null and "finance_items"."currency" is null and "finance_items"."starts_on" is null
          and "finance_items"."ends_on" is null and "finance_items"."contract_number" is null and "finance_items"."payer_name" is null
          and "finance_items"."expense_kind" is null and "finance_items"."payee_id" is null
        end);--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_group_check" CHECK ("reminder_sets"."group_id" is not null or "reminder_sets"."finance_item_id" is not null);