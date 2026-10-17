CREATE TABLE "finance_attachments" (
	"item_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "finance_attachments_item_id_file_id_pk" PRIMARY KEY("item_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "finance_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_folders_name_check" CHECK (char_length("finance_folders"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "finance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"type" text NOT NULL,
	"folder_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"contract_number" text,
	"amount_minor" bigint,
	"currency" text,
	"starts_on" date,
	"ends_on" date,
	"search_text" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_items_type_check" CHECK ("finance_items"."type" in ('contract', 'document', 'note')),
	CONSTRAINT "finance_items_title_check" CHECK (char_length("finance_items"."title") between 1 and 200),
	CONSTRAINT "finance_items_body_check" CHECK (char_length("finance_items"."body") <= 10000),
	CONSTRAINT "finance_items_contract_check" CHECK (case when "finance_items"."type" = 'contract'
        then "finance_items"."amount_minor" is not null and "finance_items"."currency" is not null
          and "finance_items"."starts_on" is not null and "finance_items"."ends_on" is not null
        else "finance_items"."amount_minor" is null and "finance_items"."currency" is null and "finance_items"."starts_on" is null
          and "finance_items"."ends_on" is null and "finance_items"."contract_number" is null
        end),
	CONSTRAINT "finance_items_amount_check" CHECK ("finance_items"."amount_minor" is null or "finance_items"."amount_minor" >= 0),
	CONSTRAINT "finance_items_currency_check" CHECK ("finance_items"."currency" is null or "finance_items"."currency" in ('EUR', 'UAH')),
	CONSTRAINT "finance_items_period_check" CHECK ("finance_items"."ends_on" is null or "finance_items"."ends_on" >= "finance_items"."starts_on"),
	CONSTRAINT "finance_items_number_check" CHECK ("finance_items"."contract_number" is null or char_length("finance_items"."contract_number") <= 60)
);
--> statement-breakpoint
CREATE TABLE "finance_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rate_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"effective_from" date,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_rates_rate_check" CHECK ("finance_rates"."rate_minor" > 0),
	CONSTRAINT "finance_rates_currency_check" CHECK ("finance_rates"."currency" = 'EUR')
);
--> statement-breakpoint
CREATE TABLE "finance_time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"task_id" text,
	"ticket_id" text,
	"linked_ticket_id" text,
	"title" text,
	"minutes" integer,
	"worked_on" date,
	"covered_by_tasks" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"filled_at" timestamp (3) with time zone,
	CONSTRAINT "finance_time_entries_source_check" CHECK ("finance_time_entries"."source" in ('task', 'ticket', 'manual')),
	CONSTRAINT "finance_time_entries_minutes_check" CHECK ("finance_time_entries"."minutes" is null or "finance_time_entries"."minutes" between 0 and 6000),
	CONSTRAINT "finance_time_entries_note_check" CHECK (char_length("finance_time_entries"."note") <= 500),
	CONSTRAINT "finance_time_entries_subject_check" CHECK (case "finance_time_entries"."source"
        when 'task' then "finance_time_entries"."ticket_id" is null
        when 'ticket' then "finance_time_entries"."task_id" is null and "finance_time_entries"."linked_ticket_id" is null
        else "finance_time_entries"."task_id" is null and "finance_time_entries"."ticket_id" is null and "finance_time_entries"."linked_ticket_id" is null
        end),
	CONSTRAINT "finance_time_entries_manual_check" CHECK ("finance_time_entries"."source" <> 'manual' or ("finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null)),
	CONSTRAINT "finance_time_entries_title_check" CHECK ("finance_time_entries"."source" = 'manual' or "finance_time_entries"."title" is not null),
	CONSTRAINT "finance_time_entries_covered_check" CHECK (not "finance_time_entries"."covered_by_tasks" or ("finance_time_entries"."source" = 'ticket' and "finance_time_entries"."minutes" = 0))
);
--> statement-breakpoint
ALTER TABLE "reminder_sets" DROP CONSTRAINT "reminder_sets_subject_check";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "finance_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD COLUMN "finance_item_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "finance_access_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "finance_access_by" text;--> statement-breakpoint
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_item_id_finance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_folders" ADD CONSTRAINT "finance_folders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_folders" ADD CONSTRAINT "finance_folders_parent_id_finance_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_folders" ADD CONSTRAINT "finance_folders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_folder_id_finance_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."finance_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_items" ADD CONSTRAINT "finance_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rates" ADD CONSTRAINT "finance_rates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rates" ADD CONSTRAINT "finance_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_linked_ticket_id_tickets_id_fk" FOREIGN KEY ("linked_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_time_entries" ADD CONSTRAINT "finance_time_entries_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_attachments_file_idx" ON "finance_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "finance_folders_group_idx" ON "finance_folders" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "finance_folders_parent_idx" ON "finance_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "finance_items_group_created_idx" ON "finance_items" USING btree ("group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "finance_items_folder_created_idx" ON "finance_items" USING btree ("folder_id","group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "finance_items_contract_starts_idx" ON "finance_items" USING btree ("starts_on","group_id") WHERE "finance_items"."type" = 'contract';--> statement-breakpoint
CREATE INDEX "finance_items_contract_ends_idx" ON "finance_items" USING btree ("ends_on") WHERE "finance_items"."type" = 'contract';--> statement-breakpoint
CREATE INDEX "finance_items_search_idx" ON "finance_items" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_items_created_by_idx" ON "finance_items" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_rates_user_from_unique" ON "finance_rates" USING btree ("user_id",coalesce("effective_from", '-infinity'::date));--> statement-breakpoint
CREATE INDEX "finance_rates_user_from_idx" ON "finance_rates" USING btree ("user_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "finance_time_entries_task_user_unique" ON "finance_time_entries" USING btree ("task_id","user_id") WHERE "finance_time_entries"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_time_entries_ticket_user_unique" ON "finance_time_entries" USING btree ("ticket_id","user_id") WHERE "finance_time_entries"."ticket_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_group_day_idx" ON "finance_time_entries" USING btree ("group_id","worked_on","id") WHERE "finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_day_group_idx" ON "finance_time_entries" USING btree ("worked_on","group_id") WHERE "finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_user_day_idx" ON "finance_time_entries" USING btree ("user_id","worked_on") WHERE "finance_time_entries"."minutes" is not null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_open_requests_idx" ON "finance_time_entries" USING btree ("user_id") WHERE "finance_time_entries"."minutes" is null and "finance_time_entries"."worked_on" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_task_idx" ON "finance_time_entries" USING btree ("task_id") WHERE "finance_time_entries"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_unit_idx" ON "finance_time_entries" USING btree (coalesce("ticket_id", "linked_ticket_id"),"worked_on") WHERE "finance_time_entries"."ticket_id" is not null or "finance_time_entries"."linked_ticket_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_time_entries_linked_ticket_idx" ON "finance_time_entries" USING btree ("linked_ticket_id") WHERE "finance_time_entries"."linked_ticket_id" is not null;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_finance_item_id_finance_items_id_fk" FOREIGN KEY ("finance_item_id") REFERENCES "public"."finance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_finance_access_by_user_id_fk" FOREIGN KEY ("finance_access_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_sets_finance_item_unique" ON "reminder_sets" USING btree ("finance_item_id");--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_subject_check" CHECK (num_nonnulls("reminder_sets"."knowledge_item_id", "reminder_sets"."task_id", "reminder_sets"."finance_item_id") = 1);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_finance_access_check" CHECK ("user"."finance_access_at" is null or "user"."role" in ('admin', 'superadmin'));