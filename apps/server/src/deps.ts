import type { Config } from './infra/config/config.js';
import {
  createAiProvider,
  createMeetingSummaryProvider,
  createTextToolsProvider,
  createTicketDraftProvider,
  createTranscriptionProvider,
} from './modules/ai/index.js';
import type { TicketDraftProvider } from './modules/ai/ticket-draft.js';
import type { TextToolsProvider } from './modules/ai/text-tools.js';
import type { MeetingSummaryProvider } from './modules/ai/meeting-summary.js';
import type { TaskSplitProvider } from './modules/ai/provider.js';
import type { TranscriptionProvider } from './modules/ai/transcription.js';
import { meetingAiJobHandlers, MEETING_AI_JOB } from './modules/knowledge/meeting-ai.js';
import { recordingJobHandlers, RECORDING_JOB } from './modules/knowledge/meeting-recording.js';
import {
  MEETING_SERIES_JOB,
  meetingSeriesJobHandlers,
  meetingSeriesSchedules,
} from './modules/knowledge/meeting-series.js';
import { createFakeMedia, createFfmpeg, type MediaTools } from './infra/media/media.js';
import { createSandboxMedia } from './infra/media/sandbox-client.js';
import { authJobHandlers, AUTH_CLEANUP_JOB } from './modules/auth/jobs.js';
import {
  bulkEmailJobHandlers,
  bulkEmailQueues,
  bulkEmailSchedules,
} from './modules/bulk-email/jobs.js';
import { filesJobHandlers, FILES_CLEANUP_JOB } from './modules/files/jobs.js';
import { mcpJobHandlers, MCP_AUDIT_CLEANUP_JOB } from './modules/mcp/jobs.js';
import { projectsJobHandlers, PROJECTS_INBOX_CLEANUP_JOB } from './modules/projects/jobs.js';
import {
  notificationQueues,
  notificationSchedules,
  notificationsJobHandlers,
} from './modules/notifications/jobs.js';
import { registerKnowledgeReminderSubject } from './modules/knowledge/reminder-subject.js';
import { registerEventReminderSubject } from './modules/projects/reminder-subject.js';
import { registerTaskReminderSubject } from './modules/tasks/reminder-subject.js';
import { reminderSchedules, remindersJobHandlers } from './modules/reminders/jobs.js';
import { tasksJobHandlers, taskSchedules } from './modules/tasks/jobs.js';
import type { TeamsGraph } from './modules/teams/graph-client.js';
import {
  createTeams,
  teamsJobHandlers,
  teamsSchedules,
  TEAMS_SERIES_JOB,
  TRANSCRIPT_POLL_JOB,
} from './modules/teams/jobs.js';
import { createDb, type Db } from './infra/db/client.js';
import {
  createBulkSender,
  createEmailSender,
  emailJobHandlers,
  emailQueues,
  type BulkEmailSender,
  type EmailSender,
} from './infra/email/index.js';
import { createDeferredQueue, startJobs, type JobQueue } from './infra/jobs/jobs.js';
import { createPushSender, type PushSender } from './infra/push/index.js';
import { createDiskStorage, type Storage } from './infra/storage/index.js';

/** Everything a module needs from the outside world; every module plugin receives this. */
export type AppDeps = {
  config: Config;
  db: Db;
  email: EmailSender;
  /** The bulk email sender (Phase 23), separate from the transactional `email`. */
  bulkEmail: BulkEmailSender;
  storage: Storage;
  jobs: JobQueue;
  /** null when web push is not configured. */
  push: PushSender | null;
  /** The AI task split provider; null when AI is off (no OpenAI key). */
  ai: TaskSplitProvider | null;
  /** ffmpeg for meeting recordings (Phase 30). */
  media: MediaTools;
  /** Meeting speech to text (Phase 30); null when off. */
  transcription: TranscriptionProvider | null;
  /** The meeting summary AI (Phase 30); null when AI is off. */
  meetingSummary: MeetingSummaryProvider | null;
  /** The chat composer's AI text tools (Phase 28); null when AI is off. */
  textTools: TextToolsProvider | null;
  /** The ticket reply draft AI ("Navrhnúť odpoveď"); null when AI is off. */
  ticketDraft: TicketDraftProvider | null;
  /** Microsoft Graph for Teams (T1); null when Teams is not configured (the feature is inert). */
  teams: TeamsGraph | null;
};

/** Creates the real dependencies. `close` stops the jobs, then the database. */
export async function createDeps(
  config: Config,
): Promise<{ deps: AppDeps; close(): Promise<void> }> {
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const email = createEmailSender(config.email);
  const bulkEmail = createBulkSender(config.bulkEmail, config.email);
  const storage = createDiskStorage(config.filesDir, config.appSecret);
  const push = createPushSender(config.push);
  // The notification and reminder handlers send jobs to the queue built from them; a job that
  // runs before startJobs returns waits for it.
  const forward = createDeferredQueue();
  // `fake` (e2e only) copies bytes instead of transcoding. Production runs ffmpeg in the media
  // sandbox container (ADR 0048); without its socket (dev, tests) the local hardened ffmpeg.
  const media =
    config.ffmpegPath === 'fake'
      ? createFakeMedia()
      : config.mediaSandboxSocket
        ? createSandboxMedia({ socketPath: config.mediaSandboxSocket })
        : createFfmpeg(config.ffmpegPath);
  if (
    config.nodeEnv === 'production' &&
    !config.mediaSandboxSocket &&
    config.ffmpegPath !== 'fake'
  ) {
    console.warn('media: MEDIA_SANDBOX_SOCKET is not set, ffmpeg runs in the app container');
  }
  const transcription = createTranscriptionProvider(config.transcription);
  const meetingSummary = createMeetingSummaryProvider(config.ai);
  const teams = createTeams(config);
  // The fire job loads subjects through the registry.
  registerKnowledgeReminderSubject();
  registerTaskReminderSubject();
  registerEventReminderSubject();
  const jobs = await startJobs(
    config.databaseUrl,
    {
      ...emailJobHandlers(email),
      ...authJobHandlers(db),
      ...filesJobHandlers({ db, storage }),
      ...mcpJobHandlers(db),
      ...projectsJobHandlers({ db }),
      ...notificationsJobHandlers({ db, config, push, jobs: forward.queue }),
      ...tasksJobHandlers({ db, jobs: forward.queue }),
      ...remindersJobHandlers({ db, jobs: forward.queue }),
      ...bulkEmailJobHandlers({ db, config, bulkEmail, jobs: forward.queue }),
      ...recordingJobHandlers({ db, storage, media, jobs: forward.queue }),
      ...meetingAiJobHandlers({
        db,
        storage,
        media,
        jobs: forward.queue,
        ai: { transcription, summary: meetingSummary },
      }),
      ...meetingSeriesJobHandlers({ db }),
      ...teamsJobHandlers({ db, config, teams }),
    },
    [
      { name: AUTH_CLEANUP_JOB, cron: '15 3 * * *' }, // daily, 03:15
      { name: FILES_CLEANUP_JOB, cron: '30 3 * * *' },
      { name: MCP_AUDIT_CLEANUP_JOB, cron: '20 3 * * *' }, // MCP audit rows over 180 days
      { name: PROJECTS_INBOX_CLEANUP_JOB, cron: '35 3 * * *' }, // eGrant inbox, 180 days
      ...notificationSchedules, // delivery sweep every minute, purge at 03:45
      ...taskSchedules, // deadline and urgent reminders, Bratislava time
      ...reminderSchedules, // fire due reminders every minute
      ...bulkEmailSchedules(config), // stuck-send sweep 04:15; Elastic sync 04:30 (elastic driver)
      ...meetingSeriesSchedules, // recurring calls: the next calls, hourly (ADR 0049)
      ...teamsSchedules(config), // Teams transcript poll and series sync every 5 minutes (only when configured)
    ],
    {
      ...emailQueues,
      ...notificationQueues,
      ...bulkEmailQueues,
      // One ffmpeg at a time (CPU); two AI runs at once. A delayed retry waits for the 30 s poll.
      [RECORDING_JOB]: { localConcurrency: 1 },
      [MEETING_AI_JOB]: { localConcurrency: 2 },
      // One series run at a time; a run still going absorbs the next tick.
      [MEETING_SERIES_JOB]: { policy: 'stately' as const },
      // One poll at a time; a run that is still going absorbs the next tick.
      ...(teams
        ? {
            [TRANSCRIPT_POLL_JOB]: { policy: 'stately' as const },
            [TEAMS_SERIES_JOB]: { policy: 'stately' as const },
          }
        : {}),
    }, // concurrency and policies; the rest: defaults
  );
  forward.resolve(jobs.queue);
  return {
    deps: {
      config,
      db,
      email,
      bulkEmail,
      storage,
      jobs: jobs.queue,
      push,
      ai: createAiProvider(config.ai),
      media,
      transcription,
      meetingSummary,
      textTools: createTextToolsProvider(config.textAi),
      ticketDraft: createTicketDraftProvider(config.ai),
      teams,
    },
    async close() {
      await jobs.stop();
      await closeDb();
    },
  };
}
