ALTER TABLE "ticket_area_rules" ADD COLUMN "source" text DEFAULT 'help' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_area_rules" DROP CONSTRAINT "ticket_area_rules_group_id_area_key_user_id_pk";--> statement-breakpoint
ALTER TABLE "ticket_area_rules" ADD CONSTRAINT "ticket_area_rules_group_id_area_key_user_id_source_pk" PRIMARY KEY("group_id","area_key","user_id","source");--> statement-breakpoint
ALTER TABLE "ticket_area_rules" ADD CONSTRAINT "ticket_area_rules_source_check" CHECK ("ticket_area_rules"."source" in ('help', 'egrant'));
