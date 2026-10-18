import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  ErrorCodes,
  MEETING_LIMITS,
  TasksFromMeetingSchema,
  type KnowledgeItemDto,
  type SessionUser,
  type TaskProposals,
  type TasksFromMessageResult,
  type TranscriptText,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { decodeFileNameHeader } from '../files/file-name.js';
import { FileTooLargeError, InvalidAttachmentError } from '../files/service.js';
import { emitTasks } from '../tasks/events.js';
import { InvalidAssigneeError, NotFoundError, toTaskDto } from '../tasks/task-service.js';
import { isAdmin } from '../users/policy.js';
import {
  InvalidRecordingError,
  InvalidTranscriptFileError,
  MeetingAiUnavailableError,
  MeetingBusyError,
  NothingToProcessError,
  RecordingBusyError,
} from './errors.js';
import { emitMeetingTasks } from './events.js';
import { canRunMeetingAi, requestMeetingAi, type MeetingAi } from './meeting-ai.js';
import { deleteRecording, uploadRecording } from './meeting-recording.js';
import { createMeetingTasks, meetingTaskProposals } from './meeting-tasks.js';
import { shareMeetingTranscript } from './meeting-teams.js';
import { canProcessMeeting } from './policy.js';
import { knowledgeError } from './routes.js';
import { transcriptFileText } from './transcript-text.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** The detail's `canProcess`: an admin, and the AI this meeting needs is configured. */
export function withMeetingAi(
  item: KnowledgeItemDto,
  actor: SessionUser,
  ai: MeetingAi,
): KnowledgeItemDto {
  const meeting = item.meetingDetail;
  if (!meeting) return item;
  const canProcess =
    canProcessMeeting(actor) &&
    canRunMeetingAi(ai, {
      transcript: meeting.transcript,
      recordingState: meeting.recording.state,
    });
  return { ...item, meetingDetail: { ...meeting, canProcess } };
}

export const meetingAiOf = (deps: AppDeps): MeetingAi => ({
  transcription: deps.transcription,
  summary: deps.meetingSummary,
});

/** Maps the meeting errors, then the knowledge ones. */
function meetingError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof InvalidRecordingError) return send(reply, 400, ErrorCodes.invalidRecording);
  if (error instanceof RecordingBusyError) return send(reply, 409, ErrorCodes.recordingBusy);
  if (error instanceof MeetingBusyError) return send(reply, 409, ErrorCodes.meetingBusy);
  if (error instanceof NothingToProcessError) return send(reply, 400, ErrorCodes.nothingToProcess);
  if (error instanceof MeetingAiUnavailableError) return send(reply, 503, ErrorCodes.aiUnavailable);
  if (error instanceof InvalidTranscriptFileError) {
    return send(reply, 400, ErrorCodes.invalidTranscriptFile);
  }
  if (error instanceof FileTooLargeError) {
    return reply.code(413).header('connection', 'close').send({ error: ErrorCodes.fileTooLarge });
  }
  if (error instanceof NotFoundError) return send(reply, 404, ErrorCodes.notFound);
  if (error instanceof InvalidAssigneeError) return send(reply, 400, ErrorCodes.invalidAssignee);
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  return knowledgeError(reply, error);
}

/**
 * Meetings (Phase 30): the recording upload and delete, the AI run, the action items as tasks,
 * and the text of a transcript file.
 */
export const meetingRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, storage } = deps;
  const anyUser = requireUser(app.auth);
  const allowUpload = createRateLimiter({ windowMs: 60 * 60_000, max: 10 });
  const allowRun = createRateLimiter({ windowMs: 60 * 60_000, max: 20 });
  const allowTranscriptFile = createRateLimiter({ windowMs: 60_000, max: 30 });
  const allowTasks = createRateLimiter({ windowMs: 60_000, max: 30 });
  const limited = (reply: FastifyReply) => send(reply, 429, ErrorCodes.rateLimited);

  // Raw bodies: the recording is streamed (never buffered), a transcript file is buffered.
  await app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    raw.post<IdParams>(
      '/knowledge/:id/recording',
      { preHandler: anyUser },
      async (request, reply) => {
        const actor = request.user!;
        if (Number(request.headers['content-length']) > MEETING_LIMITS.recordingBytes) {
          return meetingError(reply, new FileTooLargeError());
        }
        if (!allowUpload(actor.id)) return limited(reply);
        try {
          await uploadRecording(deps, actor, request.params.id, {
            name: decodeFileNameHeader(request.headers['x-file-name'] as string | undefined),
            declaredType: request.headers['content-type'],
            body: request.raw,
          });
        } catch (error) {
          return meetingError(reply, error);
        }
        return reply.code(202).send();
      },
    );

    raw.post('/knowledge/transcript-text', { preHandler: anyUser }, async (request, reply) => {
      const actor = request.user!;
      if (!allowTranscriptFile(actor.id)) return limited(reply);
      const declared = Number(request.headers['content-length']);
      if (declared > MEETING_LIMITS.transcriptFileBytes) {
        return meetingError(reply, new FileTooLargeError());
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request.raw) {
        size += (chunk as Buffer).length;
        if (size > MEETING_LIMITS.transcriptFileBytes) {
          request.raw.destroy();
          return meetingError(reply, new FileTooLargeError());
        }
        chunks.push(chunk as Buffer);
      }
      const name = decodeFileNameHeader(request.headers['x-file-name'] as string | undefined);
      try {
        const body: TranscriptText = { text: transcriptFileText(name, Buffer.concat(chunks)) };
        return body;
      } catch (error) {
        return meetingError(reply, error);
      }
    });
  });

  app.delete<IdParams>(
    '/knowledge/:id/recording',
    { preHandler: anyUser },
    async (request, reply) => {
      try {
        await deleteRecording({ db, storage }, request.user!, request.params.id);
      } catch (error) {
        return meetingError(reply, error);
      }
      return reply.code(204).send();
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/meeting/process',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      // Clients learn nothing about the limit: 403 (or 404) comes first.
      if (isAdmin(actor) && !allowRun(actor.id)) return limited(reply);
      try {
        await requestMeetingAi(
          { db, jobs: deps.jobs, ai: meetingAiOf(deps) },
          actor,
          request.params.id,
        );
      } catch (error) {
        return meetingError(reply, error);
      }
      return reply.code(202).send();
    },
  );

  // Teams T1: an imported transcript (and its summary) becomes visible to the client.
  app.post<IdParams>(
    '/knowledge/:id/meeting/share-transcript',
    { preHandler: anyUser },
    async (request, reply) => {
      try {
        await shareMeetingTranscript(db, request.user!, request.params.id);
      } catch (error) {
        return meetingError(reply, error);
      }
      return reply.code(204).send();
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/meeting/task-proposals',
    { preHandler: anyUser },
    async (request, reply) => {
      try {
        const body: TaskProposals = {
          tasks: await meetingTaskProposals(db, request.user!, request.params.id),
          files: [],
        };
        return body;
      } catch (error) {
        return meetingError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/meeting/tasks',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      if (!allowTasks(actor.id)) return limited(reply);
      const body = TasksFromMeetingSchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      let created;
      try {
        created = await createMeetingTasks(deps, actor, request.params.id, body.data);
      } catch (error) {
        return meetingError(reply, error);
      }
      const person = { id: actor.id, name: actor.name };
      emitTasks(app.io, created.tasks.map(toTaskDto), person);
      // The meeting's other open views list its tasks: they refetch.
      try {
        await emitMeetingTasks(app.io, db, request.params.id);
      } catch (error) {
        request.log.error({ err: error }, 'could not refresh the tasks of a meeting');
      }
      const result: TasksFromMessageResult = { tasks: created.tasks };
      return reply.code(201).send(result);
    },
  );
};
