CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "knowledge_attachments" (
	"item_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "knowledge_attachments_item_id_file_id_pk" PRIMARY KEY("item_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"type" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"search_text" text NOT NULL,
	CONSTRAINT "knowledge_items_type_check" CHECK ("knowledge_items"."type" in ('note', 'file', 'link', 'reminder')),
	CONSTRAINT "knowledge_items_visibility_check" CHECK ("knowledge_items"."visibility" in ('public', 'admins')),
	CONSTRAINT "knowledge_items_url_check" CHECK (("knowledge_items"."type" = 'link') = ("knowledge_items"."url" is not null)),
	CONSTRAINT "knowledge_items_title_check" CHECK (char_length("knowledge_items"."title") <= 200)
);
--> statement-breakpoint
CREATE TABLE "reminder_recipients" (
	"set_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "reminder_recipients_set_id_user_id_pk" PRIMARY KEY("set_id","user_id"),
	CONSTRAINT "reminder_recipients_source_check" CHECK ("reminder_recipients"."source" in ('author', 'added', 'subscribed'))
);
--> statement-breakpoint
CREATE TABLE "reminder_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"knowledge_item_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_sets_subject_check" CHECK (num_nonnulls("reminder_sets"."knowledge_item_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "reminder_times" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "admins_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_set_id_reminder_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."reminder_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_times" ADD CONSTRAINT "reminder_times_set_id_reminder_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."reminder_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_attachments_file_id_idx" ON "knowledge_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_group_created_idx" ON "knowledge_items" USING btree ("group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "knowledge_items_created_idx" ON "knowledge_items" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "knowledge_items_created_by_idx" ON "knowledge_items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "knowledge_items_search_idx" ON "knowledge_items" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "reminder_recipients_user_id_idx" ON "reminder_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reminder_sets_group_id_idx" ON "reminder_sets" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_sets_knowledge_item_unique" ON "reminder_sets" USING btree ("knowledge_item_id");--> statement-breakpoint
CREATE INDEX "reminder_times_due_idx" ON "reminder_times" USING btree ("at") WHERE "reminder_times"."fired_at" is null;--> statement-breakpoint
CREATE INDEX "reminder_times_set_at_idx" ON "reminder_times" USING btree ("set_id","at");