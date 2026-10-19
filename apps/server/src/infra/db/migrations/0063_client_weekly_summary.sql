CREATE TABLE "weekly_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"week" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"skip_reason" text,
	"source" text,
	"ai_failed" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'sk' NOT NULL,
	"content" jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_summaries_group_week_unique" UNIQUE("group_id","week"),
	CONSTRAINT "weekly_summaries_week_check" CHECK ("weekly_summaries"."week" ~ '^\d{4}-W\d{2}$'),
	CONSTRAINT "weekly_summaries_window_check" CHECK ("weekly_summaries"."window_end" > "weekly_summaries"."window_start"),
	CONSTRAINT "weekly_summaries_status_check" CHECK ("weekly_summaries"."status" in ('preparing', 'draft', 'sending', 'sent', 'skipped')),
	CONSTRAINT "weekly_summaries_skip_reason_check" CHECK ("weekly_summaries"."skip_reason" is null or "weekly_summaries"."skip_reason" in ('no_activity', 'manager')),
	CONSTRAINT "weekly_summaries_source_check" CHECK ("weekly_summaries"."source" is null or "weekly_summaries"."source" in ('ai', 'facts')),
	CONSTRAINT "weekly_summaries_language_check" CHECK ("weekly_summaries"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'))
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_admin_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"remind" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_group_settings" (
	"group_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_recipients" (
	"summary_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"language" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "weekly_summary_recipients_summary_id_user_id_pk" PRIMARY KEY("summary_id","user_id"),
	CONSTRAINT "weekly_summary_recipients_language_check" CHECK ("weekly_summary_recipients"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk')),
	CONSTRAINT "weekly_summary_recipients_status_check" CHECK ("weekly_summary_recipients"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_reminders" (
	"user_id" text NOT NULL,
	"week" text NOT NULL,
	CONSTRAINT "weekly_summary_reminders_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"summary_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"language" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_summary_revisions_language_check" CHECK ("weekly_summary_revisions"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk')),
	CONSTRAINT "weekly_summary_revisions_source_check" CHECK ("weekly_summary_revisions"."source" in ('ai', 'facts'))
);
--> statement-breakpoint
CREATE TABLE "weekly_summary_unsubscribes" (
	"user_id" text NOT NULL,
	"group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_summary_unsubscribes_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_admin_prefs" ADD CONSTRAINT "weekly_summary_admin_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_group_settings" ADD CONSTRAINT "weekly_summary_group_settings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_group_settings" ADD CONSTRAINT "weekly_summary_group_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_recipients" ADD CONSTRAINT "weekly_summary_recipients_summary_id_weekly_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."weekly_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_recipients" ADD CONSTRAINT "weekly_summary_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_reminders" ADD CONSTRAINT "weekly_summary_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_revisions" ADD CONSTRAINT "weekly_summary_revisions_summary_id_weekly_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."weekly_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_revisions" ADD CONSTRAINT "weekly_summary_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_unsubscribes" ADD CONSTRAINT "weekly_summary_unsubscribes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summary_unsubscribes" ADD CONSTRAINT "weekly_summary_unsubscribes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_summaries_week_status_group_idx" ON "weekly_summaries" USING btree ("week","status","group_id");--> statement-breakpoint
CREATE INDEX "weekly_summaries_group_window_idx" ON "weekly_summaries" USING btree ("group_id","window_end","id");--> statement-breakpoint
CREATE INDEX "weekly_summaries_window_idx" ON "weekly_summaries" USING btree ("window_end","id");--> statement-breakpoint
CREATE INDEX "weekly_summaries_search_fold_trgm_idx" ON "weekly_summaries" USING gin (spolu_fold("search_text") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "weekly_summaries_group_draft_idx" ON "weekly_summaries" USING btree ("group_id","status") WHERE "weekly_summaries"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "weekly_summaries_stuck_idx" ON "weekly_summaries" USING btree ("status","updated_at") WHERE "weekly_summaries"."status" in ('preparing', 'sending');--> statement-breakpoint
CREATE INDEX "weekly_summaries_updated_by_idx" ON "weekly_summaries" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "weekly_summaries_sent_by_idx" ON "weekly_summaries" USING btree ("sent_by");--> statement-breakpoint
CREATE INDEX "weekly_summary_group_settings_updated_by_idx" ON "weekly_summary_group_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "weekly_summary_recipients_user_idx" ON "weekly_summary_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "weekly_summary_recipients_pending_idx" ON "weekly_summary_recipients" USING btree ("summary_id") WHERE "weekly_summary_recipients"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "weekly_summary_recipients_purge_idx" ON "weekly_summary_recipients" USING btree ("sent_at") WHERE "weekly_summary_recipients"."email" is not null;--> statement-breakpoint
CREATE INDEX "weekly_summary_revisions_summary_idx" ON "weekly_summary_revisions" USING btree ("summary_id","created_at");--> statement-breakpoint
CREATE INDEX "weekly_summary_revisions_created_by_idx" ON "weekly_summary_revisions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "weekly_summary_unsubscribes_group_idx" ON "weekly_summary_unsubscribes" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "tasks_group_due_open_idx" ON "tasks" USING btree ("group_id","due_date") WHERE "tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "tickets_group_resolved_idx" ON "tickets" USING btree ("group_id","resolved_at") WHERE "tickets"."resolved_at" is not null;