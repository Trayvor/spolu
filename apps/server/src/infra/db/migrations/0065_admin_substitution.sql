CREATE TABLE "admin_substitutions" (
	"id" text PRIMARY KEY NOT NULL,
	"substituted_id" text NOT NULL,
	"substitute_id" text NOT NULL,
	"ends_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	CONSTRAINT "admin_substitutions_not_self" CHECK ("admin_substitutions"."substituted_id" <> "admin_substitutions"."substitute_id")
);
--> statement-breakpoint
ALTER TABLE "group_managers" ADD COLUMN "substitution_id" text;--> statement-breakpoint
ALTER TABLE "admin_substitutions" ADD CONSTRAINT "admin_substitutions_substituted_id_user_id_fk" FOREIGN KEY ("substituted_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_substitutions" ADD CONSTRAINT "admin_substitutions_substitute_id_user_id_fk" FOREIGN KEY ("substitute_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_substitutions" ADD CONSTRAINT "admin_substitutions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_substitutions" ADD CONSTRAINT "admin_substitutions_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_substitutions_active_substituted_idx" ON "admin_substitutions" USING btree ("substituted_id") WHERE "admin_substitutions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "admin_substitutions_active_substitute_idx" ON "admin_substitutions" USING btree ("substitute_id") WHERE "admin_substitutions"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_substitution_id_admin_substitutions_id_fk" FOREIGN KEY ("substitution_id") REFERENCES "public"."admin_substitutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_managers_substitution_id_idx" ON "group_managers" USING btree ("substitution_id") WHERE "group_managers"."substitution_id" is not null;