CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"actor_token_id" text,
	"actor_label" text NOT NULL,
	"actor_detail" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_label" text NOT NULL,
	"group_id" text,
	"category" text DEFAULT 'general' NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cause_id" text,
	CONSTRAINT "audit_log_actor_kind_check" CHECK ("audit_log"."actor_kind" in ('user', 'mcp', 'egrant', 'system')),
	CONSTRAINT "audit_log_category_check" CHECK ("audit_log"."category" in ('general', 'finance')),
	CONSTRAINT "audit_log_actor_check" CHECK (("audit_log"."actor_kind" in ('user', 'mcp')) = ("audit_log"."actor_user_id" is not null)),
	CONSTRAINT "audit_log_token_check" CHECK (("audit_log"."actor_kind" = 'mcp') = ("audit_log"."actor_token_id" is not null)),
	CONSTRAINT "audit_log_changes_size_check" CHECK (pg_column_size("audit_log"."changes") <= 16384)
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_type_idx" ON "audit_log" USING btree ("entity_type","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_group_idx" ON "audit_log" USING btree ("group_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_idx" ON "audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."actor_user_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_actor_token_idx" ON "audit_log" USING btree ("actor_token_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."actor_token_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_actor_kind_idx" ON "audit_log" USING btree ("actor_kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."actor_kind" <> 'user';--> statement-breakpoint
CREATE INDEX "audit_log_general_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."category" = 'general';--> statement-breakpoint
CREATE INDEX "audit_log_cause_idx" ON "audit_log" USING btree ("cause_id") WHERE "audit_log"."cause_id" is not null;--> statement-breakpoint
CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- The one sanctioned UPDATE: anonymizeActor replaces labels inside a transaction that set
    -- spolu.audit_anonymize; what a row says happened (who, what, when) never changes.
    IF current_setting('spolu.audit_anonymize', true) = 'on'
       AND new.id = old.id AND new.created_at = old.created_at
       AND new.actor_kind = old.actor_kind
       AND new.actor_user_id IS NOT DISTINCT FROM old.actor_user_id
       AND new.actor_token_id IS NOT DISTINCT FROM old.actor_token_id
       AND new.entity_type = old.entity_type AND new.entity_id = old.entity_id
       AND new.group_id IS NOT DISTINCT FROM old.group_id
       AND new.category = old.category AND new.action = old.action
       AND new.cause_id IS NOT DISTINCT FROM old.cause_id THEN
      RETURN new;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'SPA01';
  END IF;
  IF old.created_at > now() - interval '730 days' THEN
    RAISE EXCEPTION 'audit_log rows are kept 730 days' USING ERRCODE = 'SPA01';
  END IF;
  RETURN old;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
