CREATE INDEX "bulk_subscriptions_campaign_idx" ON "bulk_subscriptions" USING btree ("campaign_id") WHERE "bulk_subscriptions"."campaign_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_parent_id_idx" ON "messages" USING btree ("parent_id") WHERE "messages"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_reply_to_id_idx" ON "messages" USING btree ("reply_to_id") WHERE "messages"."reply_to_id" is not null;--> statement-breakpoint
CREATE INDEX "read_states_channel_idx" ON "read_states" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "thread_read_states_channel_idx" ON "thread_read_states" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "pending_invites_group_idx" ON "pending_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "notification_events_group_idx" ON "notification_events" USING btree ("group_id") WHERE "notification_events"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "task_attachments_file_idx" ON "task_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "tickets_created_idx" ON "tickets" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);