DROP INDEX "tasks_group_id_idx";--> statement-breakpoint
DROP INDEX "tasks_urgent_idx";--> statement-breakpoint
DROP INDEX "tickets_subject_trgm_idx";--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "bulk_recipients_campaign_name_idx" ON "bulk_recipients" USING btree ("campaign_id","name","user_id");--> statement-breakpoint
CREATE INDEX "finance_time_entries_group_project_idx" ON "finance_time_entries" USING btree ("group_id","project_id");--> statement-breakpoint
CREATE INDEX "group_members_group_removed_idx" ON "group_members" USING btree ("group_id","role") WHERE "group_members"."removed_at" is not null;--> statement-breakpoint
CREATE INDEX "groups_name_id_idx" ON "groups" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "tasks_group_search_order_idx" ON "tasks" USING btree ("group_id",("completed_at" is not null),"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tasks_urgent_open_idx" ON "tasks" USING btree ("urgent") WHERE "tasks"."urgent" and "tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "tickets_body_head_trgm_idx" ON "tickets" USING gin (left("body", 200) gin_trgm_ops) WITH (fastupdate=false);--> statement-breakpoint
CREATE INDEX "tickets_unassigned_open_created_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST) WHERE "tickets"."group_id" is null and "tickets"."status" in ('new', 'in_progress');--> statement-breakpoint
CREATE INDEX "tickets_subject_trgm_idx" ON "tickets" USING gin ("subject" gin_trgm_ops) WITH (fastupdate=false);