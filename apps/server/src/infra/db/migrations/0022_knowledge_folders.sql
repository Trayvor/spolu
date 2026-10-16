CREATE TABLE "knowledge_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_folders_visibility_check" CHECK ("knowledge_folders"."visibility" in ('public', 'admins')),
	CONSTRAINT "knowledge_folders_name_check" CHECK (char_length("knowledge_folders"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_parent_id_knowledge_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_folders_group_idx" ON "knowledge_folders" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "knowledge_folders_parent_idx" ON "knowledge_folders" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_items_folder_created_idx" ON "knowledge_items" USING btree ("folder_id","group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);