-- Night integration (2026-10-19): one migration for global search (#143), the notification
-- centre (#155), mentions from descriptions (#162), recurring calls (#165), admin passkeys (#164)
-- and the phone navigation choice (#160).
-- Global search: the fold of `normalizeSearch` (NFD, combining marks removed, lower-cased).
-- Hand-written: PL/pgSQL with a high cost, so it is never inlined and the planner prefers the
-- trigram indexes over folding every row (see `infra/db/fold.ts`, ADR 0046). It comes first:
-- the `*_fold_trgm_idx` indexes below use it.
CREATE FUNCTION spolu_fold(t text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE COST 1000
  AS $$ BEGIN RETURN lower(regexp_replace(normalize(t, NFD), '[̀-ͯ]', '', 'g')); END $$;--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"webauthn_user_id" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text DEFAULT '' NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_meeting_series" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"frequency" text NOT NULL,
	"time_zone" text NOT NULL,
	"anchor_starts_at" timestamp (3) with time zone NOT NULL,
	"anchor_index" integer DEFAULT 0 NOT NULL,
	"until" date,
	"count" integer,
	"next_index" integer DEFAULT 1 NOT NULL,
	"next_starts_at" timestamp (3) with time zone,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"folder_id" text,
	"meeting_url" text,
	"reminder_offsets" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"reminder_recipient_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_meeting_series_frequency_check" CHECK ("knowledge_meeting_series"."frequency" in ('weekly', 'biweekly', 'monthly_date', 'monthly_weekday')),
	CONSTRAINT "knowledge_meeting_series_visibility_check" CHECK ("knowledge_meeting_series"."visibility" in ('public', 'admins')),
	CONSTRAINT "knowledge_meeting_series_end_check" CHECK ("knowledge_meeting_series"."until" is null or "knowledge_meeting_series"."count" is null)
);
--> statement-breakpoint
CREATE TABLE "knowledge_seen" (
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_seen_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "notification_centre_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_seen" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_seen_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "teams_series_plans" (
	"series_id" text PRIMARY KEY NOT NULL,
	"organizer_user_id" text NOT NULL,
	"organizer_entra_id" text NOT NULL,
	"organizer_name" text,
	"duration_minutes" integer NOT NULL,
	"record_automatically" boolean NOT NULL,
	"attendees" jsonb NOT NULL,
	"next_index" integer NOT NULL,
	"last_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "notification_events_undelivered_idx";--> statement-breakpoint
DROP INDEX "notification_events_unseen_task_idx";--> statement-breakpoint
DROP INDEX "notification_events_unseen_ticket_idx";--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD COLUMN "series_index" integer;--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "in_centre" boolean;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_nav" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_seen" ADD CONSTRAINT "knowledge_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_seen" ADD CONSTRAINT "knowledge_seen_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_centre_state" ADD CONSTRAINT "notification_centre_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_seen" ADD CONSTRAINT "project_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_seen" ADD CONSTRAINT "project_seen_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_series_plans" ADD CONSTRAINT "teams_series_plans_series_id_knowledge_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."knowledge_meeting_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_series_plans" ADD CONSTRAINT "teams_series_plans_organizer_user_id_user_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_next_idx" ON "knowledge_meeting_series" USING btree ("next_starts_at") WHERE "knowledge_meeting_series"."next_starts_at" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_group_idx" ON "knowledge_meeting_series" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_folder_idx" ON "knowledge_meeting_series" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_created_by_idx" ON "knowledge_meeting_series" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "knowledge_seen_item_id_idx" ON "knowledge_seen" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "project_seen_project_id_idx" ON "project_seen" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "teams_series_plans_organizer_user_idx" ON "teams_series_plans" USING btree ("organizer_user_id");--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD CONSTRAINT "knowledge_meetings_series_id_knowledge_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."knowledge_meeting_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_name_fold_trgm_idx" ON "groups" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_meetings_series_unique" ON "knowledge_meetings" USING btree ("series_id","series_index") WHERE "knowledge_meetings"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_events_held_idx" ON "notification_events" USING btree ("created_at") WHERE "notification_events"."delivered_at" is null and "notification_events"."in_centre";--> statement-breakpoint
CREATE INDEX "notification_events_centre_idx" ON "notification_events" USING btree ("user_id","created_at","id") WHERE "notification_events"."in_centre";--> statement-breakpoint
CREATE INDEX "notification_events_description_mention_idx" ON "notification_events" USING btree ("user_id","created_at") WHERE "notification_events"."kind" = 'description.mention';--> statement-breakpoint
CREATE INDEX "project_events_name_fold_trgm_idx" ON "project_events" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_name_fold_trgm_idx" ON "projects" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_title_fold_trgm_idx" ON "tasks" USING gin (spolu_fold("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_subject_fold_trgm_idx" ON "tickets" USING gin (spolu_fold("subject") gin_trgm_ops) WITH (fastupdate=false);--> statement-breakpoint
CREATE INDEX "user_search_fold_trgm_idx" ON "user" USING gin (spolu_fold("name" || ' ' || "email") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notification_events_undelivered_idx" ON "notification_events" USING btree ("created_at") WHERE "notification_events"."delivered_at" is null and "notification_events"."in_centre" is null;--> statement-breakpoint
CREATE INDEX "notification_events_unseen_task_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'taskId'),"created_at") WHERE ("notification_events"."kind" in ('task.assigned', 'task.moved', 'task.deadline', 'task.due_changed', 'task.overdue', 'chat.message', 'chat.mention', 'chat.thread_reply', 'description.mention') and ("notification_events"."payload" ->> 'taskId') is not null);--> statement-breakpoint
CREATE INDEX "notification_events_unseen_ticket_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'ticketId'),"created_at") WHERE ("notification_events"."kind" in ('ticket.created', 'ticket.unassigned', 'ticket.message', 'ticket.status', 'ticket.updated', 'ticket.tasks', 'ticket.assigned', 'ticket.time_missing', 'ticket.resolved', 'chat.mention', 'description.mention') and ("notification_events"."payload" ->> 'ticketId') is not null);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_nav_check" CHECK ("user"."phone_nav" in ('classic', 'bottom'));