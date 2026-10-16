CREATE TABLE "pending_invites" (
	"user_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "group_members_group_id_idx";--> statement-breakpoint
ALTER TABLE "group_members" DROP CONSTRAINT "group_members_pkey";--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_group_id_pk" PRIMARY KEY("user_id","group_id");--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "role" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_group_active_idx" ON "group_members" USING btree ("group_id","role") WHERE "group_members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "group_members_user_active_idx" ON "group_members" USING btree ("user_id") WHERE "group_members"."removed_at" is null;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_role_check" CHECK ("group_members"."role" in ('client', 'ziadatel'));--> statement-breakpoint
-- A client removed before Phase 21 was removed as an account; their one membership is removed too.
UPDATE "group_members" m SET "removed_at" = u."disabled_at" FROM "user" u WHERE u."id" = m."user_id" AND u."role" = 'client' AND u."disabled_at" IS NOT NULL;