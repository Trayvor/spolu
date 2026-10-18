CREATE TABLE "finance_backfills" (
	"name" text PRIMARY KEY NOT NULL,
	"done_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_items" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD COLUMN "event_id" text;--> statement-breakpoint
CREATE INDEX "finance_items_contract_project_idx" ON "finance_items" USING btree ("group_id","project_id","starts_on") WHERE "finance_items"."type" = 'contract';--> statement-breakpoint
CREATE INDEX "finance_time_entries_group_project_day_idx" ON "finance_time_entries" USING btree ("group_id","project_id","worked_on") WHERE "finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_group_event_day_idx" ON "finance_time_entries" USING btree ("group_id","event_id","worked_on") WHERE "finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_project_check" CHECK ("finance_items"."project_id" is null or ("finance_items"."type" = 'contract' and "finance_items"."group_id" is not null));--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_event_check" CHECK ("finance_time_entries"."event_id" is null or "finance_time_entries"."project_id" is not null);