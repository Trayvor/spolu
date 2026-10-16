CREATE TABLE "group_managers" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_managers_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_notification_settings" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_managers_user_id_idx" ON "group_managers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "group_notification_settings" ADD CONSTRAINT "group_notification_settings_origin_check" CHECK ("group_notification_settings"."origin" in ('user', 'manager'));--> statement-breakpoint
-- Hand-written seed (Phase 18). Makes each active admin a manager of the groups where they are
-- assigned to an open task or wrote in a chat in the last 60 days. It leaves their notification
-- modes alone. Idempotent: on conflict do nothing.
-- seed group_managers: start
insert into "group_managers" ("group_id", "user_id")
select t."group_id", ta."user_id"
  from "task_assignees" ta
  join "tasks" t on t."id" = ta."task_id"
  join "user" u on u."id" = ta."user_id"
 where t."completed_at" is null
   and u."role" in ('admin', 'superadmin') and u."disabled_at" is null
union
select c."group_id", m."author_id"
  from "messages" m
  join "channels" c on c."id" = m."channel_id"
  join "user" u on u."id" = m."author_id"
 where m."created_at" > now() - interval '60 days' and m."deleted_at" is null
   and u."role" in ('admin', 'superadmin') and u."disabled_at" is null
on conflict do nothing;
-- seed group_managers: end
