CREATE TABLE "knowledge_seen" (
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_seen_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "project_seen" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_seen_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
DROP INDEX "notification_events_unseen_task_idx";--> statement-breakpoint
DROP INDEX "notification_events_unseen_ticket_idx";--> statement-breakpoint
ALTER TABLE "knowledge_seen" ADD CONSTRAINT "knowledge_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_seen" ADD CONSTRAINT "knowledge_seen_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_seen" ADD CONSTRAINT "project_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_seen" ADD CONSTRAINT "project_seen_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_seen_item_id_idx" ON "knowledge_seen" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "project_seen_project_id_idx" ON "project_seen" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notification_events_description_mention_idx" ON "notification_events" USING btree ("user_id","created_at") WHERE "notification_events"."kind" = 'description.mention';--> statement-breakpoint
CREATE INDEX "notification_events_unseen_task_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'taskId'),"created_at") WHERE ("notification_events"."kind" in ('task.assigned', 'task.moved', 'task.deadline', 'task.due_changed', 'task.overdue', 'chat.message', 'chat.mention', 'chat.thread_reply', 'description.mention') and ("notification_events"."payload" ->> 'taskId') is not null);--> statement-breakpoint
CREATE INDEX "notification_events_unseen_ticket_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'ticketId'),"created_at") WHERE ("notification_events"."kind" in ('ticket.created', 'ticket.unassigned', 'ticket.message', 'ticket.status', 'ticket.updated', 'ticket.tasks', 'ticket.assigned', 'ticket.time_missing', 'ticket.resolved', 'chat.mention', 'description.mention') and ("notification_events"."payload" ->> 'ticketId') is not null);