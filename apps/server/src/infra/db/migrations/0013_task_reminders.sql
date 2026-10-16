ALTER TABLE "reminder_sets" DROP CONSTRAINT "reminder_sets_subject_check";--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_sets_task_unique" ON "reminder_sets" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "reminder_sets" ADD CONSTRAINT "reminder_sets_subject_check" CHECK (num_nonnulls("reminder_sets"."knowledge_item_id", "reminder_sets"."task_id") = 1);