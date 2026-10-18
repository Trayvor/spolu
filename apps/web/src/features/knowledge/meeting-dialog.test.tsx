import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import type { GroupPerson, KnowledgeItemDto, MeetingDetail, Me } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createKnowledge } from './api';
import { KnowledgeDialog } from './knowledge-dialog';
import {
  emptyKnowledgeValue,
  toDraft,
  toPatch,
  fromItem,
  validateKnowledge,
} from './knowledge-form';
import { processMeeting } from './meeting-api';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createKnowledge: vi.fn(),
  updateKnowledge: vi.fn(),
}));
vi.mock('./meeting-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./meeting-api')>()),
  processMeeting: vi.fn(async () => undefined),
  uploadRecording: vi.fn(async () => undefined),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ADMIN: Me = {
  id: 'u2',
  email: 'b@example.com',
  name: 'Boris',
  role: 'admin',
  finance: false,
  groups: [],
};
const CLIENT: Me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Anna',
  role: 'client',
  finance: false,
  groups: [],
};
const PEOPLE: GroupPerson[] = [{ id: 'u1', name: 'Anna', isAdmin: false, isManager: false }];

function detail(over: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    startsAt: '2030-01-10T09:00:00.000Z',
    meetingUrl: 'https://teams.example.com/m/1',
    recordingUrl: null,
    transcriptUrl: null,
    transcript: '',
    transcriptSource: null,
    transcriptAdminsOnly: false,
    recording: { state: 'none', file: null },
    ai: { state: 'idle', error: null, updatedAt: null },
    summary: null,
    canProcess: true,
    tasks: [],
    actionItemsLeft: 0,
    ...over,
  };
}

function meeting(over: Partial<KnowledgeItemDto> = {}, meet: Partial<MeetingDetail> = {}) {
  return {
    id: 'k1',
    groupId: 'g1',
    type: 'meeting',
    visibility: 'public',
    title: 'Kickoff',
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 0,
    lastReminderAt: null,
    createdBy: { id: 'u2', name: 'Boris' },
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    folderId: null,
    folderPath: [],
    meeting: {
      startsAt: '2030-01-10T09:00:00.000Z',
      recording: 'none',
      ai: 'idle',
      hasSummary: false,
    },
    body: 'Agenda',
    files: [],
    reminder: null,
    canEdit: true,
    visibilityLocked: false,
    meetingDetail: detail(meet),
    ...over,
  } satisfies KnowledgeItemDto;
}

let current: KnowledgeItemDto = meeting();

beforeEach(() => {
  current = meeting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/people')) return new Response(JSON.stringify(PEOPLE), { status: 200 });
      if (url.endsWith('/knowledge/folders')) return Response.json({ folders: [] });
      if (url.includes('/knowledge/')) return Response.json(current);
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderDialog(
  target: Parameters<typeof KnowledgeDialog>[0]['target'] = { mode: 'view', id: 'k1' },
  me: Me = ADMIN,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session'], me);
  const onClose = vi.fn();
  // In a router: the dialog guards unsaved edits against Back (`useBlocker`).
  const rootRoute = createRootRoute({
    component: () => <KnowledgeDialog target={target} onClose={onClose} onUnavailable={vi.fn()} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, onClose };
}

describe('meeting form values', () => {
  it('a new meeting has no reminder; its draft sends the meeting and empty links as null', () => {
    const value = emptyKnowledgeValue('meeting');
    expect(value.times).toEqual([]);
    const draft = toDraft(
      'meeting',
      {
        ...value,
        title: 'Call',
        meeting: {
          ...value.meeting,
          date: '2030-01-10',
          time: '10:00',
          meetingUrl: ' https://x.example ',
        },
      },
      { people: PEOPLE },
    );
    expect(draft).toMatchObject({
      type: 'meeting',
      title: 'Call',
      meeting: {
        startsAt: new Date('2030-01-10T10:00:00').toISOString(),
        meetingUrl: 'https://x.example',
        recordingUrl: null,
        transcriptUrl: null,
        transcript: '',
      },
    });
    expect('reminder' in draft).toBe(false);
  });

  it('an edit sends only the changed meeting fields; bad links are refused', () => {
    const item = meeting();
    const value = fromItem(item);
    expect(toPatch(item, value, { people: PEOPLE })).toEqual({ updatedAt: item.updatedAt });
    const patch = toPatch(
      item,
      { ...value, meeting: { ...value.meeting, transcript: 'Typed', meetingUrl: '' } },
      { people: PEOPLE },
    );
    expect(patch).toEqual({
      updatedAt: item.updatedAt,
      meeting: { transcript: 'Typed', meetingUrl: null },
    });
    const errors = validateKnowledge('meeting', {
      ...value,
      meeting: { ...value.meeting, recordingUrl: 'ftp://nope', date: '' },
    });
    expect(errors.recordingUrl).toBe(t('knowledge.form.errors.urlInvalid'));
    expect(errors.when).toBe(t('knowledge.meeting.whenRequired'));
  });
});

describe('meeting dialog', () => {
  it('creates a meeting from the form', async () => {
    vi.mocked(createKnowledge).mockResolvedValue(meeting({ id: 'k9' }));
    const user = userEvent.setup();
    const { onClose } = renderDialog({ mode: 'create', type: 'meeting', groupId: 'g1' });
    await screen.findByRole('heading', { name: t('knowledge.detail.new.meeting') });
    await user.type(screen.getByLabelText(t('knowledge.form.title')), 'Kickoff');
    await user.type(
      screen.getByLabelText(t('knowledge.meeting.meetingUrl')),
      'https://zoom.example/1',
    );
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.create') }));
    expect(createKnowledge).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        type: 'meeting',
        title: 'Kickoff',
        meeting: expect.objectContaining({ meetingUrl: 'https://zoom.example/1' }),
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('k9'));
  });

  it('view: the date, the join link, and Process with AI for an admin', async () => {
    current = meeting({}, { transcript: 'Hello' });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('heading', { name: 'Kickoff' });
    expect(screen.getByRole('link', { name: t('knowledge.meeting.join') })).toHaveAttribute(
      'href',
      'https://teams.example.com/m/1',
    );
    await user.click(screen.getByRole('button', { name: t('knowledge.meeting.ai.process') }));
    expect(processMeeting).toHaveBeenCalledWith('k1');
  });

  it('view: the summary with its lists; a client gets no AI button and no Create tasks', async () => {
    current = meeting(
      { canEdit: false, createdBy: { id: 'u2', name: 'Boris' } },
      {
        canProcess: false,
        ai: { state: 'done', error: null, updatedAt: null },
        transcript: 'Full text',
        transcriptSource: 'ai',
        summary: {
          summary: 'We agreed on the budget.',
          decisions: ['Apply in May'],
          actionItems: [{ text: 'Send the list', assignee: 'Anna', deadline: '2030-01-15' }],
          openQuestions: ['Who signs?'],
          language: 'en',
        },
      },
    );
    renderDialog({ mode: 'view', id: 'k1' }, CLIENT);
    await screen.findByText('We agreed on the budget.');
    expect(screen.getByText('Apply in May')).toBeInTheDocument();
    expect(screen.getByText('Send the list')).toBeInTheDocument();
    expect(screen.getByText('Who signs?')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('knowledge.meeting.ai.processAgain') }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('knowledge.meeting.ai.createTasks') }),
    ).toBeNull();
    expect(screen.getByText(t('knowledge.meeting.transcript'))).toBeInTheDocument();
  });

  it('view: once tasks were made, they show as links instead of the action items', async () => {
    const summary = {
      summary: 'We agreed on the budget.',
      decisions: [],
      actionItems: [
        { text: 'Send the list', assignee: 'Anna', deadline: null },
        { text: 'Book the room', assignee: null, deadline: null },
      ],
      openQuestions: [],
      language: 'en',
    };
    current = meeting(
      {},
      {
        ai: { state: 'done', error: null, updatedAt: null },
        summary,
        actionItemsLeft: 1,
        tasks: [
          {
            id: 't1',
            title: 'Send the list',
            completed: false,
            bucket: { kind: 'egrant_review', name: null },
            assignees: [{ id: 'u1', name: 'Anna' }],
          },
          {
            id: 't2',
            title: 'Old one',
            completed: true,
            bucket: { kind: 'done', name: null },
            assignees: [],
          },
        ],
      },
    );
    renderDialog();
    const link = await screen.findByRole('link', { name: 'Send the list' });
    expect(link).toHaveAttribute('href', '/groups/g1/tasks/t1');
    const done = screen.getByRole('link', { name: /^Old one/ });
    expect(done).toHaveAttribute('href', '/groups/g1/tasks/t2');
    expect(done).toHaveTextContent(t('knowledge.meeting.ai.taskCompleted'));
    expect(screen.getByText(`${t('tasks.buckets.egrantReview')}, Anna`)).toBeInTheDocument();
    expect(screen.getByText(t('knowledge.meeting.ai.tasksTitle'), { exact: false })).toBeVisible();
    // The proposals are gone: no action item list, no "Create tasks".
    expect(screen.queryByText('Book the room')).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('knowledge.meeting.ai.createTasks') }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: t('knowledge.meeting.ai.createMoreTasks') }),
    ).toBeInTheDocument();
  });

  it('view: a client sees the task links but never "Create more tasks"', async () => {
    current = meeting(
      { canEdit: false },
      {
        canProcess: false,
        ai: { state: 'done', error: null, updatedAt: null },
        summary: {
          summary: 'S',
          decisions: [],
          actionItems: [{ text: 'Send the list', assignee: null, deadline: null }],
          openQuestions: [],
          language: 'en',
        },
        actionItemsLeft: 1,
        tasks: [
          {
            id: 't1',
            title: 'Renamed',
            completed: false,
            bucket: { kind: 'custom', name: 'Later' },
            assignees: [],
          },
        ],
      },
    );
    renderDialog({ mode: 'view', id: 'k1' }, CLIENT);
    expect(await screen.findByRole('link', { name: 'Renamed' })).toBeInTheDocument();
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('knowledge.meeting.ai.createMoreTasks') }),
    ).toBeNull();
  });

  it('view: a run in progress shows its step instead of the button', async () => {
    current = meeting(
      {},
      {
        recording: { state: 'processing', file: null },
        ai: { state: 'transcribing', error: null, updatedAt: null },
      },
    );
    renderDialog();
    expect(await screen.findByText(t('knowledge.meeting.ai.transcribing'))).toBeInTheDocument();
    expect(screen.getByText(t('knowledge.meeting.recording.processing'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('knowledge.meeting.ai.process') })).toBeNull();
  });
});
