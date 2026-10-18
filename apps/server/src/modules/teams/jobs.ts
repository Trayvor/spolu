import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { createGraphClient, loadPrivateKey, type TeamsGraph } from './graph-client.js';
import { syncTeamsSeries, TEAMS_SERIES_JOB } from './series.js';
import { pollDueMeetings, TRANSCRIPT_POLL_JOB } from './transcripts.js';

export { TEAMS_SERIES_JOB, TRANSCRIPT_POLL_JOB };

/**
 * The Graph client of the configured app; null when Teams is off (the feature is inert). A
 * certificate's key is read and checked here, so a missing, encrypted or non-RSA key stops the
 * start with a clear message instead of failing every later Graph call.
 */
export function createTeams(
  config: Pick<Config, 'teams'>,
  fetchImpl?: typeof fetch,
): TeamsGraph | null {
  if (!config.teams) return null;
  const credential = config.teams.credential;
  const key = credential.kind === 'certificate' ? loadPrivateKey(credential.keyPath) : undefined;
  return createGraphClient({
    config: config.teams,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(key ? { key } : {}),
  });
}

/**
 * The transcript poll and the series sync (ADR 0049: a Teams meeting per later call of a
 * series); no handler at all while Teams is off.
 */
export function teamsJobHandlers(deps: {
  db: Db;
  config: Config;
  teams: TeamsGraph | null;
}): JobHandlers {
  const graph = deps.teams;
  if (!graph) return {};
  return {
    [TRANSCRIPT_POLL_JOB]: async () => void (await pollDueMeetings({ db: deps.db, graph })),
    [TEAMS_SERIES_JOB]: async () =>
      void (await syncTeamsSeries({ db: deps.db, config: deps.config, graph })),
  };
}

/** Every 5 minutes while Teams is configured (spec schedule; the due rows decide the rest). */
export function teamsSchedules(config: Config): JobSchedule[] {
  return config.teams
    ? [
        { name: TRANSCRIPT_POLL_JOB, cron: '*/5 * * * *' },
        { name: TEAMS_SERIES_JOB, cron: '*/5 * * * *' },
      ]
    : [];
}
