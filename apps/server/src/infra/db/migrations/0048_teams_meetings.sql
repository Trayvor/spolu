CREATE TABLE "teams_meeting_links" (
	"item_id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"organizer_user_id" text,
	"organizer_entra_id" text NOT NULL,
	"organizer_name" text,
	"online_meeting_id" text,
	"join_url" text NOT NULL,
	"event_id" text,
	"ical_uid" text,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"record_automatically" boolean DEFAULT false NOT NULL,
	"record_applied" boolean DEFAULT false NOT NULL,
	"transcript_state" text DEFAULT 'waiting' NOT NULL,
	"transcript_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_poll_at" timestamp (3) with time zone,
	"last_polled_at" timestamp (3) with time zone,
	"last_error" text,
	"calendar_nonce" text,
	"calendar_token_hash" text,
	"created_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_meeting_links_origin_check" CHECK ("teams_meeting_links"."origin" in ('help', 'linked')),
	CONSTRAINT "teams_meeting_links_transcript_state_check" CHECK ("teams_meeting_links"."transcript_state" in ('waiting', 'imported', 'available', 'none', 'failed')),
	CONSTRAINT "teams_meeting_links_calendar_check" CHECK (("teams_meeting_links"."calendar_nonce" is null) = ("teams_meeting_links"."calendar_token_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "teams_organizers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"entra_user_id" text NOT NULL,
	"upn" text NOT NULL,
	"display_name" text,
	"checked_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_meetings" DROP CONSTRAINT "knowledge_meetings_transcript_source_check";--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD COLUMN "transcript_admins_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams_meeting_links" ADD CONSTRAINT "teams_meeting_links_item_id_knowledge_meetings_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_meeting_links" ADD CONSTRAINT "teams_meeting_links_organizer_user_id_user_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_meeting_links" ADD CONSTRAINT "teams_meeting_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_organizers" ADD CONSTRAINT "teams_organizers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teams_meeting_links_next_poll_idx" ON "teams_meeting_links" USING btree ("next_poll_at") WHERE "teams_meeting_links"."next_poll_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_meeting_links_online_meeting_unique" ON "teams_meeting_links" USING btree ("online_meeting_id") WHERE "teams_meeting_links"."online_meeting_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_meeting_links_calendar_token_unique" ON "teams_meeting_links" USING btree ("calendar_token_hash") WHERE "teams_meeting_links"."calendar_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "teams_meeting_links_organizer_user_idx" ON "teams_meeting_links" USING btree ("organizer_user_id");--> statement-breakpoint
CREATE INDEX "teams_meeting_links_created_by_idx" ON "teams_meeting_links" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_organizers_entra_user_unique" ON "teams_organizers" USING btree ("entra_user_id");--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD CONSTRAINT "knowledge_meetings_transcript_source_check" CHECK ("knowledge_meetings"."transcript_source" is null or "knowledge_meetings"."transcript_source" in ('manual', 'ai', 'teams'));