CREATE TABLE "finance_cost_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"salary_id" text,
	"expense_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_cost_documents_target_check" CHECK (num_nonnulls("finance_cost_documents"."salary_id", "finance_cost_documents"."expense_id") = 1),
	CONSTRAINT "finance_cost_documents_self_check" CHECK ("finance_cost_documents"."expense_id" is null or "finance_cost_documents"."expense_id" <> "finance_cost_documents"."document_id")
);
--> statement-breakpoint
CREATE TABLE "finance_salaries" (
	"id" text PRIMARY KEY NOT NULL,
	"payee_id" text NOT NULL,
	"month" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_salaries_month_check" CHECK (extract(day from "finance_salaries"."month") = 1),
	CONSTRAINT "finance_salaries_amount_check" CHECK ("finance_salaries"."amount_minor" >= 0),
	CONSTRAINT "finance_salaries_currency_check" CHECK ("finance_salaries"."currency" in ('EUR', 'UAH')),
	CONSTRAINT "finance_salaries_note_check" CHECK (char_length("finance_salaries"."note") <= 10500)
);
--> statement-breakpoint
CREATE TABLE "finance_salary_attachments" (
	"salary_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "finance_salary_attachments_salary_id_file_id_pk" PRIMARY KEY("salary_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_title_check";--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_contract_check";--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_expense_kind_check";--> statement-breakpoint
ALTER TABLE "finance_items" DROP CONSTRAINT "finance_items_payee_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "finance_items_payee_idx";--> statement-breakpoint
ALTER TABLE "finance_cost_documents" ADD CONSTRAINT "finance_cost_documents_document_id_finance_items_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_cost_documents" ADD CONSTRAINT "finance_cost_documents_salary_id_finance_salaries_id_fk" FOREIGN KEY ("salary_id") REFERENCES "public"."finance_salaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_cost_documents" ADD CONSTRAINT "finance_cost_documents_expense_id_finance_items_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_salaries" ADD CONSTRAINT "finance_salaries_payee_id_user_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_salaries" ADD CONSTRAINT "finance_salaries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_salary_attachments" ADD CONSTRAINT "finance_salary_attachments_salary_id_finance_salaries_id_fk" FOREIGN KEY ("salary_id") REFERENCES "public"."finance_salaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_salary_attachments" ADD CONSTRAINT "finance_salary_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_cost_documents_salary_unique" ON "finance_cost_documents" USING btree ("salary_id","document_id") WHERE "finance_cost_documents"."salary_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_cost_documents_expense_unique" ON "finance_cost_documents" USING btree ("expense_id","document_id") WHERE "finance_cost_documents"."expense_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_cost_documents_document_idx" ON "finance_cost_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "finance_salaries_month_idx" ON "finance_salaries" USING btree ("month" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "finance_salaries_payee_month_idx" ON "finance_salaries" USING btree ("payee_id","month" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "finance_salaries_created_by_idx" ON "finance_salaries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "finance_salary_attachments_file_idx" ON "finance_salary_attachments" USING btree ("file_id");--> statement-breakpoint
-- migrate salary expenses: start
-- Owner decision of 2026-10-21 (ADR 0065): every expense of kind `salary` that names its admin
-- becomes a salary record of the same id: the month of its date, its amount and currency, its
-- title and description as the note, its files, its author and times. Its reminders go with the
-- expense (a salary has none). Each step is idempotent: run twice, the second run changes nothing.
INSERT INTO "finance_salaries" ("id", "payee_id", "month", "amount_minor", "currency", "note", "created_by", "created_at", "updated_at")
SELECT i."id", i."payee_id", date_trunc('month', i."starts_on")::date, i."amount_minor", i."currency",
  concat_ws(E'\n\n', nullif(i."title", ''), nullif(i."body", '')),
  i."created_by", i."created_at", i."updated_at"
FROM "finance_items" i
WHERE i."type" = 'expense' AND i."expense_kind" = 'salary' AND i."payee_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "finance_salary_attachments" ("salary_id", "file_id")
SELECT a."item_id", a."file_id"
FROM "finance_attachments" a
JOIN "finance_salaries" s ON s."id" = a."item_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The audit trail: a `migrated` row on the salary (what it was) and on the expense (what it became).
INSERT INTO "audit_log" ("id", "actor_kind", "actor_label", "entity_type", "entity_id", "entity_label", "group_id", "category", "action", "changes")
SELECT gen_random_uuid()::text, 'system', 'migration 0069', 'salary', s."id",
  left(coalesce(u."name", s."payee_id") || ' · ' || to_char(s."month", 'YYYY-MM'), 200), NULL, 'finance', 'migrated',
  jsonb_build_object(
    'expense', jsonb_build_object('from', jsonb_build_object('id', i."id", 'label', left(coalesce(nullif(i."title", ''), 'expense'), 200))),
    'person', jsonb_build_object('to', jsonb_build_object('id', s."payee_id", 'label', left(coalesce(u."name", s."payee_id"), 200))),
    'month', jsonb_build_object('to', to_char(s."month", 'YYYY-MM')),
    'amount', jsonb_build_object('to', jsonb_build_object('minor', s."amount_minor", 'currency', s."currency"))
  )
FROM "finance_salaries" s
JOIN "finance_items" i ON i."id" = s."id" AND i."type" = 'expense'
LEFT JOIN "user" u ON u."id" = s."payee_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "audit_log" l
  WHERE l."entity_type" = 'salary' AND l."entity_id" = s."id" AND l."action" = 'migrated'
);
--> statement-breakpoint
INSERT INTO "audit_log" ("id", "actor_kind", "actor_label", "entity_type", "entity_id", "entity_label", "group_id", "category", "action", "changes")
SELECT gen_random_uuid()::text, 'system', 'migration 0069', 'finance_item', i."id",
  left(coalesce(nullif(i."title", ''), 'expense'), 200), NULL, 'finance', 'migrated',
  jsonb_build_object(
    'salary', jsonb_build_object('to', jsonb_build_object('id', s."id", 'label', left(coalesce(u."name", s."payee_id") || ' · ' || to_char(s."month", 'YYYY-MM'), 200)))
  )
FROM "finance_salaries" s
JOIN "finance_items" i ON i."id" = s."id" AND i."type" = 'expense'
LEFT JOIN "user" u ON u."id" = s."payee_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "audit_log" l
  WHERE l."entity_type" = 'finance_item' AND l."entity_id" = i."id" AND l."action" = 'migrated'
);
--> statement-breakpoint
-- The expenses that became salaries go; their attachments and reminders cascade (the files stay,
-- attached to the salary).
DELETE FROM "finance_items" i
USING "finance_salaries" s
WHERE i."id" = s."id" AND i."type" = 'expense';
--> statement-breakpoint
-- A salary expense without an admin (the old CHECK allowed none; guarded anyway) stays an
-- expense of the neutral kind, with a title.
UPDATE "finance_items"
SET "expense_kind" = 'other', "title" = coalesce(nullif("title", ''), 'Mzda'), "payee_id" = NULL
WHERE "type" = 'expense' AND "expense_kind" = 'salary';
--> statement-breakpoint
-- migrate salary expenses: end
ALTER TABLE "finance_items" DROP COLUMN "payee_id";--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_title_check" CHECK (char_length("finance_items"."title") between 1 and 200);--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_contract_check" CHECK (case "finance_items"."type"
        when 'contract' then "finance_items"."amount_minor" is not null and "finance_items"."currency" is not null
          and "finance_items"."starts_on" is not null and "finance_items"."ends_on" is not null
          and "finance_items"."expense_kind" is null
          and ("finance_items"."group_id" is null) = ("finance_items"."payer_name" is not null)
        when 'expense' then "finance_items"."amount_minor" is not null and "finance_items"."currency" is not null
          and "finance_items"."starts_on" is not null and "finance_items"."ends_on" is not null
          and "finance_items"."ends_on" = "finance_items"."starts_on"
          and "finance_items"."group_id" is null and "finance_items"."contract_number" is null and "finance_items"."payer_name" is null
          and "finance_items"."expense_kind" is not null
        else "finance_items"."amount_minor" is null and "finance_items"."currency" is null and "finance_items"."starts_on" is null
          and "finance_items"."ends_on" is null and "finance_items"."contract_number" is null and "finance_items"."payer_name" is null
          and "finance_items"."expense_kind" is null
        end);--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_expense_kind_check" CHECK ("finance_items"."expense_kind" is null or "finance_items"."expense_kind" = 'other');
