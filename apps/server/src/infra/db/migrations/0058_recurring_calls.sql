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
ALTER TABLE "knowledge_meetings" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD COLUMN "series_index" integer;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meeting_series" ADD CONSTRAINT "knowledge_meeting_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_series_plans" ADD CONSTRAINT "teams_series_plans_series_id_knowledge_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."knowledge_meeting_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_series_plans" ADD CONSTRAINT "teams_series_plans_organizer_user_id_user_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_next_idx" ON "knowledge_meeting_series" USING btree ("next_starts_at") WHERE "knowledge_meeting_series"."next_starts_at" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_group_idx" ON "knowledge_meeting_series" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_folder_idx" ON "knowledge_meeting_series" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "knowledge_meeting_series_created_by_idx" ON "knowledge_meeting_series" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "teams_series_plans_organizer_user_idx" ON "teams_series_plans" USING btree ("organizer_user_id");--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD CONSTRAINT "knowledge_meetings_series_id_knowledge_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."knowledge_meeting_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_meetings_series_unique" ON "knowledge_meetings" USING btree ("series_id","series_index") WHERE "knowledge_meetings"."series_id" is not null;