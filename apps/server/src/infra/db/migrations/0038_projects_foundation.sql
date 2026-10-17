CREATE TABLE "knowledge_links" (
	"item_id" text NOT NULL,
	"task_id" text,
	"ticket_id" text,
	"project_id" text,
	"event_id" text,
	"knowledge_item_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "knowledge_links_subject_check" CHECK (num_nonnulls("knowledge_links"."task_id", "knowledge_links"."ticket_id", "knowledge_links"."project_id", "knowledge_links"."event_id", "knowledge_links"."knowledge_item_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "egrant_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event_id" text,
	"kind" text NOT NULL,
	"event_key" text,
	"value" jsonb NOT NULL,
	"value_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egrant_changes_kind_check" CHECK ("egrant_changes"."kind" in ('project_name', 'project_description', 'event_name', 'event_date', 'event_description', 'event_add', 'event_remove')),
	CONSTRAINT "egrant_changes_state_check" CHECK ("egrant_changes"."state" in ('pending', 'dismissed')),
	CONSTRAINT "egrant_changes_target_check" CHECK (case
        when "egrant_changes"."kind" in ('project_name', 'project_description') then "egrant_changes"."event_id" is null and "egrant_changes"."event_key" is null
        when "egrant_changes"."kind" = 'event_add' then "egrant_changes"."event_id" is null and "egrant_changes"."event_key" is not null
        else "egrant_changes"."event_id" is not null
      end)
);
--> statement-breakpoint
CREATE TABLE "egrant_project_inbox" (
	"instance_host" text NOT NULL,
	"project_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egrant_project_inbox_instance_host_project_id_pk" PRIMARY KEY("instance_host","project_id")
);
--> statement-breakpoint
CREATE TABLE "project_attachments" (
	"file_id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"event_id" text,
	CONSTRAINT "project_attachments_owner_check" CHECK (num_nonnulls("project_attachments"."project_id", "project_attachments"."event_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"occurs_on" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"egrant_name_key" text,
	"egrant_date" date,
	"created_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_events_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "project_events_name_check" CHECK (char_length("project_events"."name") between 1 and 200),
	CONSTRAINT "project_events_description_check" CHECK (char_length("project_events"."description") <= 10000),
	CONSTRAINT "project_events_source_check" CHECK ("project_events"."source" in ('manual', 'egrant'))
);
--> statement-breakpoint
CREATE TABLE "project_name_keys" (
	"project_id" text NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "project_name_keys_group_id_kind_key_pk" PRIMARY KEY("group_id","kind","key"),
	CONSTRAINT "project_name_keys_kind_check" CHECK ("project_name_keys"."kind" in ('name', 'egrant_id')),
	CONSTRAINT "project_name_keys_key_check" CHECK (char_length("project_name_keys"."key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"egrant_project_id" text,
	"created_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"egrant_delivered_at" timestamp with time zone,
	"egrant_sent_at" timestamp with time zone,
	CONSTRAINT "projects_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "projects_name_check" CHECK (char_length("projects"."name") between 1 and 200),
	CONSTRAINT "projects_description_check" CHECK (char_length("projects"."description") <= 10000),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('active', 'archived')),
	CONSTRAINT "projects_source_check" CHECK ("projects"."source" in ('manual', 'egrant')),
	CONSTRAINT "projects_egrant_id_check" CHECK ("projects"."egrant_project_id" is null or char_length("projects"."egrant_project_id") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "egrant_project_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_event_id_project_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egrant_changes" ADD CONSTRAINT "egrant_changes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egrant_changes" ADD CONSTRAINT "egrant_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egrant_changes" ADD CONSTRAINT "egrant_changes_event_id_project_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_event_id_project_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_fk" FOREIGN KEY ("project_id","group_id") REFERENCES "public"."projects"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_name_keys" ADD CONSTRAINT "project_name_keys_project_fk" FOREIGN KEY ("project_id","group_id") REFERENCES "public"."projects"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_links_item_subject_unique" ON "knowledge_links" USING btree ("item_id",coalesce("task_id", "ticket_id", "project_id", "event_id", "knowledge_item_id"));--> statement-breakpoint
CREATE INDEX "knowledge_links_task_idx" ON "knowledge_links" USING btree ("task_id") WHERE "knowledge_links"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_links_ticket_idx" ON "knowledge_links" USING btree ("ticket_id") WHERE "knowledge_links"."ticket_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_links_project_idx" ON "knowledge_links" USING btree ("project_id") WHERE "knowledge_links"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_links_event_idx" ON "knowledge_links" USING btree ("event_id") WHERE "knowledge_links"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_links_knowledge_item_idx" ON "knowledge_links" USING btree ("knowledge_item_id") WHERE "knowledge_links"."knowledge_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "egrant_changes_field_unique" ON "egrant_changes" USING btree ("project_id","kind",coalesce("event_id", "event_key", ''));--> statement-breakpoint
CREATE INDEX "egrant_changes_project_pending_idx" ON "egrant_changes" USING btree ("project_id") WHERE "egrant_changes"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "egrant_changes_group_state_idx" ON "egrant_changes" USING btree ("group_id","state");--> statement-breakpoint
CREATE INDEX "egrant_changes_event_idx" ON "egrant_changes" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "egrant_project_inbox_received_idx" ON "egrant_project_inbox" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "project_attachments_project_idx" ON "project_attachments" USING btree ("project_id") WHERE "project_attachments"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "project_attachments_event_idx" ON "project_attachments" USING btree ("event_id") WHERE "project_attachments"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "project_events_project_occurs_idx" ON "project_events" USING btree ("project_id","group_id","occurs_on","id");--> statement-breakpoint
CREATE INDEX "project_events_group_occurs_idx" ON "project_events" USING btree ("group_id","occurs_on","id");--> statement-breakpoint
CREATE INDEX "project_events_egrant_idx" ON "project_events" USING btree ("project_id","egrant_name_key","egrant_date") WHERE "project_events"."source" = 'egrant';--> statement-breakpoint
CREATE INDEX "project_events_created_by_idx" ON "project_events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "project_name_keys_project_idx" ON "project_name_keys" USING btree ("project_id","group_id");--> statement-breakpoint
CREATE INDEX "projects_group_status_name_idx" ON "projects" USING btree ("group_id","status","name_key","id");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "projects" USING btree ("created_by");--> statement-breakpoint
-- Written by hand (Drizzle cannot express it): deleting a project clears `project_id`, never
-- `group_id` (PostgreSQL 15+ column-list SET NULL). The projects service deletes the events
-- first (clearing `event_id` through the event FK), so the event CHECK always holds.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("project_id","group_id") REFERENCES "public"."projects"("id","group_id") ON DELETE SET NULL ("project_id") ON UPDATE no action;--> statement-breakpoint
-- Written by hand: deleting an event clears only `event_id`, the project stays.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_fk" FOREIGN KEY ("event_id","project_id") REFERENCES "public"."project_events"("id","project_id") ON DELETE SET NULL ("event_id") ON UPDATE cascade;--> statement-breakpoint
-- Written by hand (Drizzle cannot express it): deleting a project clears `project_id`, never
-- `group_id` (PostgreSQL 15+ column-list SET NULL). The projects service deletes the events
-- first (clearing `event_id` through the event FK), so the event CHECK always holds.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_fk" FOREIGN KEY ("project_id","group_id") REFERENCES "public"."projects"("id","group_id") ON DELETE SET NULL ("project_id") ON UPDATE no action;--> statement-breakpoint
-- Written by hand: deleting an event clears only `event_id`, the project stays.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_fk" FOREIGN KEY ("event_id","project_id") REFERENCES "public"."project_events"("id","project_id") ON DELETE SET NULL ("event_id") ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "tasks_group_project_event_idx" ON "tasks" USING btree ("group_id","project_id","event_id");--> statement-breakpoint
CREATE INDEX "tasks_event_project_idx" ON "tasks" USING btree ("event_id","project_id") WHERE "tasks"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_group_project_event_idx" ON "tickets" USING btree ("group_id","project_id","event_id");--> statement-breakpoint
CREATE INDEX "tickets_event_project_idx" ON "tickets" USING btree ("event_id","project_id") WHERE "tickets"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_waiting_project_idx" ON "tickets" USING btree ("group_id","egrant_project_id") WHERE "tickets"."project_id" is null and "tickets"."egrant_project_id" is not null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_needs_project_check" CHECK ("tasks"."event_id" is null or "tasks"."project_id" is not null);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_needs_project_check" CHECK ("tickets"."event_id" is null or "tickets"."project_id" is not null);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_needs_group_check" CHECK ("tickets"."project_id" is null or "tickets"."group_id" is not null);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_egrant_project_id_check" CHECK ("tickets"."egrant_project_id" is null or char_length("tickets"."egrant_project_id") between 1 and 100);