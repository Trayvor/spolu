ALTER TABLE "reminder_sets" DROP CONSTRAINT "reminder_sets_subject_check";--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_event_id_project_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_sets_event_unique" ON "reminder_sets" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_subject_check" CHECK (num_nonnulls("reminder_sets"."knowledge_item_id", "reminder_sets"."task_id", "reminder_sets"."finance_item_id", "reminder_sets"."event_id") = 1);