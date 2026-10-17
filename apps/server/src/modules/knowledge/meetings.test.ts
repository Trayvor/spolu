import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BoardDtoSchema,
  HomeMeetingsSchema,
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  TaskProposalsSchema,
  TasksFromMessageResultSchema,
  type KnowledgeItemDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFakeMeetingSummary, type MeetingSummaryProvider } from '../ai/meeting-summary.js';
import {
  createFakeTranscription,
  FAKE_TRANSCRIPT,
  type TranscriptionProvider,
} from '../ai/transcription.js';
import { files } from '../files/schema.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { MEETING_AI_JOB, meetingAiJobHandlers } from './meeting-ai.js';
import { RECORDING_JOB, recordingJobHandlers } from './meeting-recording.js';
import { knowledgeMeetings } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** A minimal zip (stored and deflated entries) for the .docx cases. */
export function zipOf(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('meetings API', () => {
  let test: TestApp;
  /** A copy without any AI. */
  let off: TestApp;
  const transcribed: number[] = [];
  let summaryImpl: MeetingSummaryProvider = createFakeMeetingSummary();
  const fakeTranscription = createFakeTranscription();
  const transcription: TranscriptionProvider = {
    name: 'spy',
    async transcribe(request, signal) {
      transcribed.push(request.audio.length);
      return fakeTranscription.transcribe(request, signal);
    },
  };
  const meetingSummary: MeetingSummaryProvider = {
    summarize: (request, signal) => summaryImpl.summarize(request, signal),
  };

  beforeAll(async () => {
    [test, off] = await Promise.all([
      buildTestApp({ transcription, meetingSummary }),
      buildTestApp(),
    ]);
  });
  afterAll(async () => {
    await Promise.all([test.app.close(), off.app.close()]);
    await Promise.all([test.close(), off.close()]);
  });

  const call = (
    app: TestApp,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.app.inject({
      method,
      url,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function newAdmin(app: TestApp = test): Promise<Person> {
    const email = newEmail();
    const admin = await addAdmin(app.deps.db, { email, name: 'Meet Admin' });
    return { id: admin.id, cookie: await loginAs(app.app, email) };
  }

  async function clientIn(groupId: string, name = 'Meet Client', app: TestApp = test) {
    const email = newEmail();
    const id = randomUUID();
    await app.deps.db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(app.deps.db, groupId, id);
    return { id, cookie: await loginAs(app.app, email) };
  }

  const newGroup = (app: TestApp = test) =>
    createGroup(app.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  const meeting = (over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
    type: 'meeting',
    title: 'Kickoff',
    body: 'Agenda',
    meeting: { startsAt: inHours(24), meetingUrl: 'https://teams.example.com/m/1', ...fields },
    ...over,
  });

  const create = async (
    cookie: string,
    groupId: string,
    draft: Record<string, unknown>,
    app: TestApp = test,
  ) => {
    const res = await call(app, 'POST', `/api/groups/${groupId}/knowledge`, cookie, draft);
    expect(res.statusCode, res.body).toBe(201);
    return KnowledgeItemDtoSchema.parse(res.json());
  };
  const get = async (cookie: string, id: string, app: TestApp = test) => {
    const res = await call(app, 'GET', `/api/knowledge/${id}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return KnowledgeItemDtoSchema.parse(res.json());
  };
  const uploadRecording = (
    cookie: string,
    id: string,
    bytes: Buffer = Buffer.from('fake audio bytes'),
    type = 'audio/mpeg',
    name = 'call.mp3',
  ) =>
    test.app.inject({
      method: 'POST',
      url: `/api/knowledge/${id}/recording`,
      headers: { cookie, 'content-type': type, 'x-file-name': encodeURIComponent(name) },
      payload: bytes,
    });
  const meetingRow = async (id: string, app: TestApp = test) =>
    (
      await app.deps.db.select().from(knowledgeMeetings).where(eq(knowledgeMeetings.itemId, id))
    )[0]!;

  describe('the item', () => {
    it('creates a meeting with its fields; the list row carries its date and states', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const startsAt = inHours(30);
      const item = await create(
        admin.cookie,
        group.id,
        meeting({}, { startsAt, recordingUrl: 'https://rec.example.com/1', transcript: 'Hello' }),
      );
      expect(item.type).toBe('meeting');
      expect(item.meetingDetail).toMatchObject({
        startsAt: new Date(startsAt).toISOString(),
        meetingUrl: 'https://teams.example.com/m/1',
        recordingUrl: 'https://rec.example.com/1',
        transcriptUrl: null,
        transcript: 'Hello',
        transcriptSource: 'manual',
        recording: { state: 'none', file: null },
        ai: { state: 'idle', error: null },
        summary: null,
        canProcess: true,
      });
      const page = KnowledgePageSchema.parse(
        (await call(test, 'GET', `/api/groups/${group.id}/knowledge`, admin.cookie)).json(),
      );
      expect(page.items[0]).toMatchObject({
        id: item.id,
        meeting: {
          startsAt: new Date(startsAt).toISOString(),
          recording: 'none',
          ai: 'idle',
          hasSummary: false,
        },
      });
    });

    it('a client of the group creates one, sees it without canProcess; search finds a link', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const item = await create(
        client.cookie,
        group.id,
        meeting({}, { transcriptUrl: 'https://docs.example.com/zapisnica-42' }),
      );
      expect(item.meetingDetail?.canProcess).toBe(false);
      const found = KnowledgePageSchema.parse(
        (
          await call(test, 'GET', `/api/groups/${group.id}/knowledge?q=zapisnica-42`, client.cookie)
        ).json(),
      );
      expect(found.items.map((i) => i.id)).toEqual([item.id]);
      const typed = KnowledgePageSchema.parse(
        (
          await call(test, 'GET', `/api/groups/${group.id}/knowledge?type=meeting`, client.cookie)
        ).json(),
      );
      expect(typed.items.map((i) => i.id)).toEqual([item.id]);
    });

    it('refuses a bad link and a missing date', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const bad = await call(
        test,
        'POST',
        `/api/groups/${group.id}/knowledge`,
        admin.cookie,
        meeting({}, { meetingUrl: 'javascript:alert(1)' }),
      );
      expect(bad.statusCode).toBe(400);
      const noDate = await call(test, 'POST', `/api/groups/${group.id}/knowledge`, admin.cookie, {
        type: 'meeting',
        title: 'X',
        meeting: {},
      });
      expect(noDate.statusCode).toBe(400);
    });

    it('edits the meeting fields and the summary; other types refuse them', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, meeting());
      const summary = {
        summary: 'We met.',
        decisions: ['Apply in May'],
        actionItems: [{ text: 'Send the list', assignee: null, deadline: null }],
        openQuestions: [],
        language: 'en',
      };
      const res = await call(test, 'PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: item.updatedAt,
        meeting: { meetingUrl: null, transcript: 'Typed', summary },
      });
      expect(res.statusCode, res.body).toBe(200);
      const edited = KnowledgeItemDtoSchema.parse(res.json());
      expect(edited.meetingDetail).toMatchObject({
        meetingUrl: null,
        transcript: 'Typed',
        transcriptSource: 'manual',
        summary,
      });
      expect(edited.meeting?.hasSummary).toBe(true);
      // The summary is searchable.
      const found = KnowledgePageSchema.parse(
        (
          await call(test, 'GET', `/api/groups/${group.id}/knowledge?q=apply may`, admin.cookie)
        ).json(),
      );
      expect(found.items.map((i) => i.id)).toContain(item.id);

      const note = await create(admin.cookie, group.id, { type: 'note', title: 'N' });
      const wrong = await call(test, 'PATCH', `/api/knowledge/${note.id}`, admin.cookie, {
        updatedAt: note.updatedAt,
        meeting: { transcript: 'x' },
      });
      expect(wrong.statusCode).toBe(400);
      const files = await call(test, 'PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: edited.updatedAt,
        fileIds: [randomUUID()],
      });
      expect(files.statusCode).toBe(400);
    });

    it('takes an optional reminder; a reminder item still needs a time', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const withReminder = await create(
        admin.cookie,
        group.id,
        meeting({ reminder: { times: [{ at: inHours(23) }], recipientIds: [] } }),
      );
      expect(withReminder.reminder?.times).toHaveLength(1);
      const cleared = await call(test, 'PATCH', `/api/knowledge/${withReminder.id}`, admin.cookie, {
        updatedAt: withReminder.updatedAt,
        reminder: { times: [], recipientIds: [] },
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(KnowledgeItemDtoSchema.parse(cleared.json()).reminder?.times ?? []).toHaveLength(0);
      const without = await create(admin.cookie, group.id, meeting());
      expect(without.reminder).toBeNull();

      const rem = await create(admin.cookie, group.id, {
        type: 'reminder',
        title: 'R',
        reminder: { times: [{ at: inHours(2) }], recipientIds: [] },
      });
      const empty = await call(test, 'PATCH', `/api/knowledge/${rem.id}`, admin.cookie, {
        updatedAt: rem.updatedAt,
        reminder: { times: [], recipientIds: [] },
      });
      expect(empty.statusCode).toBe(400);
    });
  });

  describe('the recording', () => {
    it('stores only the transcoded audio, attached to the item, and plays it in ranges', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const item = await create(client.cookie, group.id, meeting());
      const res = await uploadRecording(client.cookie, item.id, Buffer.from('0123456789'));
      expect(res.statusCode, res.body).toBe(202);
      // The inline job ran: the recording is ready, the upload is gone.
      const row = await meetingRow(item.id);
      expect(row).toMatchObject({ recordingState: 'ready', uploadKey: null });
      const detail = await get(client.cookie, item.id);
      const file = detail.meetingDetail!.recording.file!;
      expect(file).toMatchObject({ mime: 'audio/mp4', name: 'Kickoff.m4a', size: 10 });
      expect(detail.meeting?.recording).toBe('ready');
      const whole = await call(test, 'GET', `/api/files/${file.id}`, client.cookie);
      expect(whole.statusCode).toBe(200);
      expect(whole.headers['accept-ranges']).toBe('bytes');
      const part = await call(test, 'GET', `/api/files/${file.id}`, client.cookie, undefined, {
        range: 'bytes=2-5',
      });
      expect(part.statusCode).toBe(206);
      expect(part.headers['content-range']).toBe('bytes 2-5/10');
      expect(part.body).toBe('2345');
      const beyond = await call(test, 'GET', `/api/files/${file.id}`, client.cookie, undefined, {
        range: 'bytes=50-',
      });
      expect(beyond.statusCode).toBe(416);
      // The upload object itself is deleted.
      const uploads = await test.deps.storage.exists(`meeting-uploads/${item.id}/x`);
      expect(uploads).toBe(false);
    });

    it('a new recording replaces the old file; delete removes it', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, meeting());
      await uploadRecording(admin.cookie, item.id, Buffer.from('first'));
      const first = (await meetingRow(item.id)).recordingFileId!;
      await uploadRecording(admin.cookie, item.id, Buffer.from('second'));
      const second = (await meetingRow(item.id)).recordingFileId!;
      expect(second).not.toBe(first);
      expect(await test.deps.db.select().from(files).where(eq(files.id, first))).toHaveLength(0);
      const removed = await call(
        test,
        'DELETE',
        `/api/knowledge/${item.id}/recording`,
        admin.cookie,
      );
      expect(removed.statusCode).toBe(204);
      expect(await meetingRow(item.id)).toMatchObject({
        recordingState: 'none',
        recordingFileId: null,
      });
      expect(await test.deps.db.select().from(files).where(eq(files.id, second))).toHaveLength(0);
    });

    it('the recording follows the item to admins-only', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id);
      const item = await create(admin.cookie, group.id, meeting());
      await uploadRecording(admin.cookie, item.id);
      const fileId = (await meetingRow(item.id)).recordingFileId!;
      expect((await call(test, 'GET', `/api/files/${fileId}`, client.cookie)).statusCode).toBe(200);
      const fresh = await get(admin.cookie, item.id);
      const res = await call(test, 'PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: fresh.updatedAt,
        visibility: 'admins',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await call(test, 'GET', `/api/files/${fileId}`, client.cookie)).statusCode).toBe(404);
    });

    it('refuses what is not media, a non-editor, a busy recording, and another type', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id);
      const item = await create(admin.cookie, group.id, meeting());
      expect(
        (await uploadRecording(admin.cookie, item.id, undefined, 'application/pdf', 'a.pdf'))
          .statusCode,
      ).toBe(400);
      expect((await uploadRecording(client.cookie, item.id)).statusCode).toBe(403);
      await test.deps.db
        .update(knowledgeMeetings)
        .set({ recordingState: 'processing' })
        .where(eq(knowledgeMeetings.itemId, item.id));
      expect((await uploadRecording(admin.cookie, item.id)).statusCode).toBe(409);
      const note = await create(admin.cookie, group.id, { type: 'note', title: 'N' });
      expect((await uploadRecording(admin.cookie, note.id)).statusCode).toBe(404);
      const outsider = await clientIn((await newGroup()).id);
      expect((await uploadRecording(outsider.cookie, item.id)).statusCode).toBe(404);
    });

    it('a transcode that keeps failing ends as failed and deletes the upload', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, meeting());
      const res = await uploadRecording(admin.cookie, item.id, Buffer.from('NOT-MEDIA!'));
      expect(res.statusCode).toBe(202);
      // Attempt 1 failed; its retry is delayed (the inline queue skips it).
      const row = await meetingRow(item.id);
      expect(row.recordingState).toBe('processing');
      const handlers = recordingJobHandlers({
        db: test.deps.db,
        storage: test.deps.storage,
        media: test.deps.media,
        jobs: test.deps.jobs,
      });
      await handlers[RECORDING_JOB]!({ itemId: item.id, uploadKey: row.uploadKey!, attempt: 3 });
      expect(await meetingRow(item.id)).toMatchObject({
        recordingState: 'failed',
        uploadKey: null,
      });
      expect(await test.deps.storage.exists(row.uploadKey!)).toBe(false);
      expect((await get(admin.cookie, item.id)).meetingDetail?.recording.state).toBe('failed');
    });

    it('deleting the meeting deletes its recording', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, meeting());
      await uploadRecording(admin.cookie, item.id);
      const fileId = (await meetingRow(item.id)).recordingFileId!;
      expect(
        (await call(test, 'DELETE', `/api/knowledge/${item.id}`, admin.cookie)).statusCode,
      ).toBe(204);
      expect(await test.deps.db.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
    });
  });

  describe('the AI run', () => {
    const process = (cookie: string, id: string, app: TestApp = test) =>
      call(app, 'POST', `/api/knowledge/${id}/meeting/process`, cookie);

    it('transcribes the stored audio, then summarizes it', async () => {
      summaryImpl = createFakeMeetingSummary();
      const group = await newGroup();
      const admin = await newAdmin();
      await clientIn(group.id, 'Peter Novák');
      const item = await create(admin.cookie, group.id, meeting());
      await uploadRecording(admin.cookie, item.id);
      const before = transcribed.length;
      const res = await process(admin.cookie, item.id);
      expect(res.statusCode, res.body).toBe(202);
      expect(transcribed.length).toBe(before + 1);
      const detail = (await get(admin.cookie, item.id)).meetingDetail!;
      expect(detail).toMatchObject({
        transcript: FAKE_TRANSCRIPT,
        transcriptSource: 'ai',
        ai: { state: 'done', error: null },
      });
      expect(detail.summary?.decisions).toHaveLength(1);
      expect(detail.summary?.actionItems).toEqual([
        {
          text: 'Peter pripraví rozpočet do 2030-01-15.',
          assignee: 'Peter Novák',
          deadline: '2030-01-15',
        },
        { text: 'Poslať klientovi zoznam príloh.', assignee: null, deadline: null },
      ]);
      expect(detail.summary?.openQuestions).toEqual(['Kto podpíše čestné vyhlásenie?']);
    });

    it('summarizes a pasted transcript without transcribing', async () => {
      summaryImpl = createFakeMeetingSummary();
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(
        admin.cookie,
        group.id,
        meeting({}, { transcript: 'Anna: Úloha: Zavolať banke.' }),
      );
      const before = transcribed.length;
      expect((await process(admin.cookie, item.id)).statusCode).toBe(202);
      expect(transcribed.length).toBe(before);
      const detail = (await get(admin.cookie, item.id)).meetingDetail!;
      expect(detail.transcriptSource).toBe('manual');
      expect(detail.summary?.actionItems.map((a) => a.text)).toEqual(['Zavolať banke.']);
    });

    it('admins only; nothing to process; busy; AI off', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id);
      const empty = await create(admin.cookie, group.id, meeting());
      expect((await process(client.cookie, empty.id)).statusCode).toBe(403);
      expect((await process(admin.cookie, empty.id)).statusCode).toBe(400);
      const ready = await create(admin.cookie, group.id, meeting({}, { transcript: 'Text' }));
      await test.deps.db
        .update(knowledgeMeetings)
        .set({ aiState: 'summarizing' })
        .where(eq(knowledgeMeetings.itemId, ready.id));
      expect((await process(admin.cookie, ready.id)).statusCode).toBe(409);

      const offGroup = await newGroup(off);
      const offAdmin = await newAdmin(off);
      const offItem = await create(
        offAdmin.cookie,
        offGroup.id,
        meeting({}, { transcript: 'T' }),
        off,
      );
      expect(offItem.meetingDetail?.canProcess).toBe(false);
      const unavailable = await process(offAdmin.cookie, offItem.id, off);
      expect(unavailable.statusCode).toBe(503);
    });

    it('a summary that keeps failing ends as failed with its reason; the transcript stays', async () => {
      summaryImpl = {
        summarize: async () => {
          throw new Error('boom');
        },
      };
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, meeting());
      await uploadRecording(admin.cookie, item.id);
      expect((await process(admin.cookie, item.id)).statusCode).toBe(202);
      const row = await meetingRow(item.id);
      expect(row.aiState).toBe('summarizing');
      expect(row.transcriptSource).toBe('ai');
      const handlers = meetingAiJobHandlers({
        db: test.deps.db,
        storage: test.deps.storage,
        media: test.deps.media,
        jobs: test.deps.jobs,
        ai: { transcription, summary: meetingSummary },
      });
      await handlers[MEETING_AI_JOB]!({ itemId: item.id, run: row.aiRun, attempt: 3 });
      expect(await meetingRow(item.id)).toMatchObject({
        aiState: 'failed',
        aiError: 'summary_failed',
        transcript: FAKE_TRANSCRIPT,
      });
      // A stale job of an earlier run does nothing.
      await handlers[MEETING_AI_JOB]!({ itemId: item.id, run: row.aiRun - 1, attempt: 3 });
      summaryImpl = createFakeMeetingSummary();
      expect((await process(admin.cookie, item.id)).statusCode).toBe(202);
      expect((await meetingRow(item.id)).aiState).toBe('done');
    });
  });

  describe('action items as tasks', () => {
    const summary = {
      summary: 'S',
      decisions: [],
      actionItems: [
        { text: 'Prepare the budget', assignee: 'peter', deadline: '2030-02-01' },
        { text: 'Call the bank', assignee: 'Someone Else', deadline: null },
      ],
      openQuestions: [],
      language: 'en',
    };

    async function withSummary() {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id, 'Peter Novák');
      const item = await create(admin.cookie, group.id, meeting());
      const res = await call(test, 'PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: item.updatedAt,
        meeting: { summary },
      });
      expect(res.statusCode, res.body).toBe(200);
      return { group, admin, client, item: res.json<KnowledgeItemDto>() };
    }

    it('proposes cards with matched people and dates', async () => {
      const { admin, client, item } = await withSummary();
      const res = await call(
        test,
        'POST',
        `/api/knowledge/${item.id}/meeting/task-proposals`,
        admin.cookie,
      );
      expect(res.statusCode, res.body).toBe(200);
      const { tasks } = TaskProposalsSchema.parse(res.json());
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toMatchObject({
        title: 'Prepare the budget',
        assigneeIds: [client.id],
        dueDate: '2030-02-01',
      });
      expect(tasks[1]).toMatchObject({ title: 'Call the bank', assigneeIds: [], dueDate: null });
      expect(tasks[1]!.description).toContain('(Someone Else)');
      const forbidden = await call(
        test,
        'POST',
        `/api/knowledge/${item.id}/meeting/task-proposals`,
        client.cookie,
      );
      expect(forbidden.statusCode).toBe(403);
    });

    it('creates the cards in the chosen bucket, never in Completed', async () => {
      const { group, admin, item } = await withSummary();
      const board = BoardDtoSchema.parse(
        (await call(test, 'GET', `/api/groups/${group.id}/board`, admin.cookie)).json(),
      );
      const review = board.buckets.find((b) => b.kind === 'egrant_review')!;
      const done = board.buckets.find((b) => b.kind === 'done')!;
      const card = {
        title: 'Prepare the budget',
        description: '',
        assigneeIds: [],
        dueDate: null,
        urgent: false,
        link: null,
        fileIds: [],
      };
      const res = await call(
        test,
        'POST',
        `/api/knowledge/${item.id}/meeting/tasks`,
        admin.cookie,
        {
          bucketId: review.id,
          tasks: [card],
        },
      );
      expect(res.statusCode, res.body).toBe(201);
      const created = TasksFromMessageResultSchema.parse(res.json()).tasks;
      expect(created[0]).toMatchObject({ title: 'Prepare the budget', bucketId: review.id });
      const toTodo = await call(
        test,
        'POST',
        `/api/knowledge/${item.id}/meeting/tasks`,
        admin.cookie,
        {
          tasks: [card],
        },
      );
      const todo = board.buckets.find((b) => b.kind === 'todo')!;
      expect(TasksFromMessageResultSchema.parse(toTodo.json()).tasks[0]?.bucketId).toBe(todo.id);
      const completed = await call(
        test,
        'POST',
        `/api/knowledge/${item.id}/meeting/tasks`,
        admin.cookie,
        {
          bucketId: done.id,
          tasks: [card],
        },
      );
      expect(completed.statusCode).toBe(404);
    });
  });

  describe('the dashboard card', () => {
    it('lists the coming meetings and the past ones without a summary', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      // A manager hears about the client's meetings (All messages): the card lists them.
      await addManager(test.deps.db, group.id, admin.id);
      const soon = await create(
        admin.cookie,
        group.id,
        meeting({ title: 'Soon' }, { startsAt: inHours(2) }),
      );
      await create(
        admin.cookie,
        group.id,
        meeting({ title: 'Far' }, { startsAt: inHours(24 * 20) }),
      );
      const past = await create(
        admin.cookie,
        group.id,
        meeting({ title: 'Past' }, { startsAt: inHours(-5) }),
      );
      const res = await call(test, 'GET', '/api/me/home/meetings', admin.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const card = HomeMeetingsSchema.parse(res.json());
      expect(card.upcoming.map((m) => m.id)).toContain(soon.id);
      expect(card.upcoming.map((m) => m.title)).not.toContain('Far');
      expect(card.unsummarized.map((m) => m.id)).toContain(past.id);
      expect(card.upcoming.find((m) => m.id === soon.id)).toMatchObject({
        groupId: group.id,
        groupName: 'Firma',
        hasSummary: false,
      });
      const client = await clientIn(group.id);
      expect((await call(test, 'GET', '/api/me/home/meetings', client.cookie)).statusCode).toBe(
        403,
      );
    });
  });

  describe('transcript files', () => {
    const extract = (name: string, bytes: Buffer, cookie: string) =>
      test.app.inject({
        method: 'POST',
        url: '/api/knowledge/transcript-text',
        headers: {
          cookie,
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(name),
        },
        payload: bytes,
      });

    it('reads .txt, .vtt, .srt and .docx; refuses anything else', async () => {
      const admin = await newAdmin();
      const vtt =
        'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Anna>Dobrý deň\n\n00:00:03.000 --> 00:00:04.000\nAko sa máte?\n';
      expect((await extract('a.vtt', Buffer.from(vtt), admin.cookie)).json()).toEqual({
        text: 'Anna: Dobrý deň\nAko sa máte?',
      });
      const srt =
        '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\nWorld\n';
      expect((await extract('a.srt', Buffer.from(srt), admin.cookie)).json()).toEqual({
        text: 'Hello\nWorld',
      });
      expect((await extract('a.txt', Buffer.from('﻿Plain\r\ntext'), admin.cookie)).json()).toEqual({
        text: 'Plain\ntext',
      });
      const xml =
        '<w:document><w:body><w:p><w:r><w:t>First &amp; one</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Second</w:t></w:r></w:p></w:body></w:document>';
      const docx = zipOf([
        { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
        { name: 'word/document.xml', data: Buffer.from(xml), deflate: true },
      ]);
      expect((await extract('notes.docx', docx, admin.cookie)).json()).toEqual({
        text: 'First & one\nSecond',
      });
      const pdf = await extract('a.pdf', Buffer.from('%PDF'), admin.cookie);
      expect(pdf.statusCode).toBe(400);
      expect(pdf.json()).toEqual({ error: 'invalid_transcript_file' });
      expect((await extract('broken.docx', Buffer.from('nope'), admin.cookie)).statusCode).toBe(
        400,
      );
    });
  });
});
