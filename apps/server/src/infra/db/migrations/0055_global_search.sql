-- Global search (2026-10-18): the fold of `normalizeSearch` (NFD, combining marks removed,
-- lower-cased). Hand-written: PL/pgSQL with a high cost, so it is never inlined and the planner
-- prefers the trigram indexes over folding every row (see `infra/db/fold.ts`, ADR 0046).
CREATE FUNCTION spolu_fold(t text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE COST 1000
  AS $$ BEGIN RETURN lower(regexp_replace(normalize(t, NFD), '[\u0300-\u036f]', '', 'g')); END $$;--> statement-breakpoint
CREATE INDEX "groups_name_fold_trgm_idx" ON "groups" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_events_name_fold_trgm_idx" ON "project_events" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_name_fold_trgm_idx" ON "projects" USING gin (spolu_fold("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_title_fold_trgm_idx" ON "tasks" USING gin (spolu_fold("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_subject_fold_trgm_idx" ON "tickets" USING gin (spolu_fold("subject") gin_trgm_ops) WITH (fastupdate=false);--> statement-breakpoint
CREATE INDEX "user_search_fold_trgm_idx" ON "user" USING gin (spolu_fold("name" || ' ' || "email") gin_trgm_ops);
