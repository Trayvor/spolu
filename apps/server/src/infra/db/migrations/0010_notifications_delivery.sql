CREATE TABLE "group_notification_settings" (
	"user_id" text NOT NULL,
	"group_id" text NOT NULL,
	"mode" text NOT NULL,
	CONSTRAINT "group_notification_settings_user_id_group_id_pk" PRIMARY KEY("user_id","group_id"),
	CONSTRAINT "group_notification_settings_mode_check" CHECK ("group_notification_settings"."mode" in ('all', 'mentions', 'off'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "email_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "default_group_mode" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "push_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "email_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "language" text DEFAULT 'sk' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "email_fallback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_notification_settings" ADD CONSTRAINT "group_notification_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_notification_settings" ADD CONSTRAINT "group_notification_settings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_notification_settings_group_id_idx" ON "group_notification_settings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_dedupe_unique" ON "notification_events" USING btree ("user_id","dedupe_key") WHERE "notification_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_events_undelivered_idx" ON "notification_events" USING btree ("created_at") WHERE "notification_events"."delivered_at" is null;--> statement-breakpoint
CREATE INDEX "notification_events_email_due_idx" ON "notification_events" USING btree ("email_due_at") WHERE "notification_events"."emailed_at" is null and "notification_events"."email_due_at" is not null;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_default_group_mode_check" CHECK ("user"."default_group_mode" in ('all', 'mentions', 'off'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_language_check" CHECK ("user"."language" in ('sk', 'en'));--> statement-breakpoint
-- Before this release nothing set delivered_at, so every existing event looks undelivered. Mark
-- them delivered and emailed, or the delivery worker would push and email the whole backlog.
UPDATE "notification_events" SET "delivered_at" = now(), "emailed_at" = now() WHERE "delivered_at" IS NULL;
