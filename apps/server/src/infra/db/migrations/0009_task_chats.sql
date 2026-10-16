ALTER TABLE "channels" ADD CONSTRAINT "channels_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_task_unique" ON "channels" USING btree ("task_id") WHERE "channels"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "channels_group_id_idx" ON "channels" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "tasks_source_message_id_idx" ON "tasks" USING btree ("source_message_id") WHERE "tasks"."source_message_id" is not null;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_task_check" CHECK (("channels"."kind" = 'task') = ("channels"."task_id" is not null));