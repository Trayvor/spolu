CREATE TABLE "bulk_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sender" text,
	"recipient_count" integer,
	"created_by" text,
	"updated_by" text,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"send_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bulk_campaigns_status_check" CHECK ("bulk_campaigns"."status" in ('draft', 'sending', 'sent', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "bulk_images" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_images_mime_check" CHECK ("bulk_images"."mime" in ('image/png', 'image/jpeg'))
);
--> statement-breakpoint
CREATE TABLE "bulk_recipients" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider_transaction_id" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_recipients_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id"),
	CONSTRAINT "bulk_recipients_status_check" CHECK ("bulk_recipients"."status" in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "bulk_recipients_language_check" CHECK ("bulk_recipients"."language" in ('sk', 'en'))
);
--> statement-breakpoint
CREATE TABLE "bulk_subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"subscribed" boolean NOT NULL,
	"email" text NOT NULL,
	"campaign_id" text,
	"source" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bulk_subscriptions_source_check" CHECK ("bulk_subscriptions"."source" in ('link', 'one_click', 'profile', 'provider'))
);
--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_images" ADD CONSTRAINT "bulk_images_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_campaign_id_bulk_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bulk_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_subscriptions" ADD CONSTRAINT "bulk_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_subscriptions" ADD CONSTRAINT "bulk_subscriptions_campaign_id_bulk_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bulk_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_campaigns_status_updated_idx" ON "bulk_campaigns" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bulk_recipients_campaign_status_idx" ON "bulk_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "bulk_recipients_user_idx" ON "bulk_recipients" USING btree ("user_id");