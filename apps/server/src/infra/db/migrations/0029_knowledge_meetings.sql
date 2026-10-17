CREATE TABLE "knowledge_meetings" (
	"item_id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"meeting_url" text,
	"recording_url" text,
	"transcript_url" text,
	"transcript" text DEFAULT '' NOT NULL,
	"transcript_source" text,
	"recording_state" text DEFAULT 'none' NOT NULL,
	"recording_file_id" text,
	"upload_key" text,
	"ai_state" text DEFAULT 'idle' NOT NULL,
	"ai_error" text,
	"ai_run" integer DEFAULT 0 NOT NULL,
	"ai_updated_at" timestamp (3) with time zone,
	"summary" jsonb,
	CONSTRAINT "knowledge_meetings_recording_state_check" CHECK ("knowledge_meetings"."recording_state" in ('none', 'processing', 'ready', 'failed')),
	CONSTRAINT "knowledge_meetings_ai_state_check" CHECK ("knowledge_meetings"."ai_state" in ('idle', 'queued', 'transcribing', 'summarizing', 'done', 'failed')),
	CONSTRAINT "knowledge_meetings_transcript_source_check" CHECK ("knowledge_meetings"."transcript_source" is null or "knowledge_meetings"."transcript_source" in ('manual', 'ai'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_type_check";--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD CONSTRAINT "knowledge_meetings_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_meetings" ADD CONSTRAINT "knowledge_meetings_recording_file_id_files_id_fk" FOREIGN KEY ("recording_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_meetings_starts_at_idx" ON "knowledge_meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "knowledge_meetings_recording_file_idx" ON "knowledge_meetings" USING btree ("recording_file_id");--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_type_check" CHECK ("knowledge_items"."type" in ('note', 'file', 'link', 'reminder', 'meeting', 'chat_file'));