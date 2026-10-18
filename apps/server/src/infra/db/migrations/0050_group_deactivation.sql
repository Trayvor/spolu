ALTER TABLE "groups" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
-- A deactivated client group is read-only: nothing new is created in it, by any route, job or
-- integration. One guard in the database instead of a check in every write path (ADR 0038);
-- the API maps SQLSTATE SPG01 to 409 group_inactive. Edits of existing rows stay possible.
CREATE FUNCTION "refuse_in_deactivated_group"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM groups WHERE id = NEW.group_id AND deactivated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'group % is deactivated', NEW.group_id USING ERRCODE = 'SPG01';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION "refuse_message_in_deactivated_group"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM channels c JOIN groups g ON g.id = c.group_id
    WHERE c.id = NEW.channel_id AND g.deactivated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the channel''s group is deactivated' USING ERRCODE = 'SPG01';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "messages_group_active" BEFORE INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION "refuse_message_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "tasks_group_active" BEFORE INSERT ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "buckets_group_active" BEFORE INSERT ON "buckets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "tickets_group_active" BEFORE INSERT ON "tickets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "tickets_group_active_move" BEFORE UPDATE OF "group_id" ON "tickets"
  FOR EACH ROW WHEN (NEW.group_id IS DISTINCT FROM OLD.group_id)
  EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "knowledge_items_group_active" BEFORE INSERT ON "knowledge_items"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "knowledge_folders_group_active" BEFORE INSERT ON "knowledge_folders"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "projects_group_active" BEFORE INSERT ON "projects"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "project_events_group_active" BEFORE INSERT ON "project_events"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();--> statement-breakpoint
CREATE TRIGGER "reminder_sets_group_active" BEFORE INSERT ON "reminder_sets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_in_deactivated_group"();
