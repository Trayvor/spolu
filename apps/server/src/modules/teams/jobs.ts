import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { createGraphClient, type TeamsGraph } from './graph-client.js';
import { pollDueMeetings, TRANSCRIPT_POLL_JOB } from './transcripts.js';

export { TRANSCRIPT_POLL_JOB };

/** The Graph client of the configured app; null when Teams is off (the feature is inert). */
export function createTeams(config: Config, fetchImpl?: typeof fetch): TeamsGraph | null {
  if (!config.teams) return null;
  return createGraphClient({ config: config.teams, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/** The transcript poll; no handler at all while Teams is off. */
export function teamsJobHandlers(deps: { db: Db; teams: TeamsGraph | null }): JobHandlers {
  const graph = deps.teams;
  if (!graph) return {};
  return {
    [TRANSCRIPT_POLL_JOB]: async () => void (await pollDueMeetings({ db: deps.db, graph })),
  };
}

/** Every 5 minutes while Teams is configured (spec schedule; the due rows decide the rest). */
export function teamsSchedules(config: Config): JobSchedule[] {
  return config.teams ? [{ name: TRANSCRIPT_POLL_JOB, cron: '*/5 * * * *' }] : [];
}
