CREATE TABLE "task_seen" (
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_seen_user_id_task_id_pk" PRIMARY KEY("user_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_seen" (
	"user_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_seen_user_id_ticket_id_pk" PRIMARY KEY("user_id","ticket_id")
);
--> statement-breakpoint
ALTER TABLE "task_seen" ADD CONSTRAINT "task_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_seen" ADD CONSTRAINT "task_seen_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_seen" ADD CONSTRAINT "ticket_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_seen" ADD CONSTRAINT "ticket_seen_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_seen_task_id_idx" ON "task_seen" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ticket_seen_ticket_id_idx" ON "ticket_seen" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "notification_events_unseen_task_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'taskId'),"created_at") WHERE ("notification_events"."kind" in ('task.assigned', 'task.moved', 'task.deadline', 'chat.message', 'chat.mention', 'chat.thread_reply') and ("notification_events"."payload" ->> 'taskId') is not null);--> statement-breakpoint
CREATE INDEX "notification_events_unseen_ticket_idx" ON "notification_events" USING btree ("user_id",("payload" ->> 'ticketId'),"created_at") WHERE ("notification_events"."kind" in ('ticket.created', 'ticket.unassigned', 'ticket.message', 'ticket.status', 'ticket.updated', 'ticket.tasks', 'ticket.assigned', 'ticket.time_missing', 'chat.mention') and ("notification_events"."payload" ->> 'ticketId') is not null);--> statement-breakpoint
-- Changes before the release do not count: every task and ticket a user has events of is seen now.
INSERT INTO "task_seen" ("user_id", "task_id", "seen_at") SELECT DISTINCT e."user_id", t."id", now() FROM "notification_events" e JOIN "tasks" t ON t."id" = e."payload" ->> 'taskId' ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "ticket_seen" ("user_id", "ticket_id", "seen_at") SELECT DISTINCT e."user_id", k."id", now() FROM "notification_events" e JOIN "tickets" k ON k."id" = e."payload" ->> 'ticketId' ON CONFLICT DO NOTHING;