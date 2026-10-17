CREATE TABLE "message_task_links" (
	"message_id" text NOT NULL,
	"task_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_task_links_message_id_task_id_pk" PRIMARY KEY("message_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "message_ticket_links" (
	"message_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_ticket_links_message_id_ticket_id_pk" PRIMARY KEY("message_id","ticket_id")
);
--> statement-breakpoint
ALTER TABLE "message_task_links" ADD CONSTRAINT "message_task_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ticket_links" ADD CONSTRAINT "message_ticket_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_task_links_task_idx" ON "message_task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "message_ticket_links_ticket_idx" ON "message_ticket_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_subject_trgm_idx" ON "tickets" USING gin ("subject" gin_trgm_ops);