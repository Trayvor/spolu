CREATE TABLE "ticket_attachments" (
	"ticket_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "ticket_attachments_ticket_id_file_id_pk" PRIMARY KEY("ticket_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_followers" (
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_followers_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id"),
	CONSTRAINT "ticket_followers_source_check" CHECK ("ticket_followers"."source" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"group_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text NOT NULL,
	"requester_user_id" text,
	"requester_name" text,
	"requester_email" text,
	"requester_phone" text,
	"area" text,
	"subject" text,
	"programme" text,
	"body" text,
	"due_date" date,
	"url" text,
	"instance_url" text,
	"file_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"requester_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" in ('new', 'in_progress', 'resolved')),
	CONSTRAINT "tickets_source_check" CHECK ("tickets"."source" in ('api', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_ticket_id" text;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_attachments_file_idx" ON "ticket_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "ticket_followers_user_idx" ON "ticket_followers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_group_status_created_idx" ON "tickets" USING btree ("group_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_requester_created_idx" ON "tickets" USING btree ("requester_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_unassigned_created_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST) WHERE "tickets"."group_id" is null;--> statement-breakpoint
CREATE INDEX "tickets_due_open_idx" ON "tickets" USING btree ("due_date") WHERE "tickets"."status" <> 'resolved';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_ticket_id_tickets_id_fk" FOREIGN KEY ("source_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_source_ticket_id_idx" ON "tasks" USING btree ("source_ticket_id") WHERE "tasks"."source_ticket_id" is not null;