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
import type {
  GroupPerson,
  KnowledgeItemDto,
  MeetingDetail,
  MeetingSeriesInfo,
  Me,
} from '@spolu/shared';
import { i18n } from '@/i18n';
import { createKnowledge, deleteKnowledge, updateKnowledge } from './api';
import { KnowledgeDialog } from './knowledge-dialog';
import { emptyKnowledgeValue, toDraft, validateKnowledge } from './knowledge-form';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createKnowledge: vi.fn(),
  updateKnowledge: vi.fn(),
  deleteKnowledge: vi.fn(async () => undefined),
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

const SERIES: MeetingSeriesInfo = {
  id: 's1',
  frequency: 'weekly',
  timeZone: 'Europe/Bratislava',
  until: null,
  count: 5,
  index: 1,
  followingCount: 3,
  ended: true,
};

describe('recurring calls (ADR 0049): form', () => {
  it('a repeating draft sends the rule with the browser time zone', () => {
    const value = emptyKnowledgeValue('meeting');
    const draft = toDraft(
      'meeting',
      {
        ...value,
        title: 'Weekly',
        meeting: {
          ...value.meeting,
          date: '2030-01-10',
          repeat: { frequency: 'weekly', end: 'count', until: '', count: '6' },
        },
      },
      { people: PEOPLE },
    );
    expect(draft).toMatchObject({
      meeting: {
        repeat: {
          frequency: 'weekly',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          count: 6,
          until: null,
        },
      },
    });
    const single = toDraft('meeting', { ...value, title: 'Once' }, { people: PEOPLE });
    expect(single).toMatchObject({ meeting: { repeat: null } });
  });

  it('checks the end: 2 to 100 calls, a last day from the first call up to 2 years', () => {
    const value = emptyKnowledgeValue('meeting');
    const withRepeat = (repeat: Partial<typeof value.meeting.repeat>) => ({
      ...value,
      title: 'X',
      meeting: {
        ...value.meeting,
        date: '2030-01-10',
        repeat: { ...value.meeting.repeat, frequency: 'weekly' as const, ...repeat },
      },
    });
    expect(validateKnowledge('meeting', withRepeat({ end: 'count', count: '1' })).repeat).toBe(
      t('knowledge.meeting.repeat.countInvalid'),
    );
    expect(
      validateKnowledge('meeting', withRepeat({ end: 'until', until: '2029-12-31' })).repeat,
    ).toBe(t('knowledge.meeting.repeat.untilInvalid'));
    expect(
      validateKnowledge('meeting', withRepeat({ end: 'until', until: '2032-01-11' })).repeat,
    ).toBe(t('knowledge.meeting.repeat.untilInvalid'));
    expect(
      validateKnowledge('meeting', withRepeat({ end: 'until', until: '2030-06-30' })).repeat,
    ).toBeUndefined();
  });

  it('the create form offers the rules of the chosen day', async () => {
    vi.mocked(createKnowledge).mockResolvedValue(meeting({ id: 'k9' }));
    const user = userEvent.setup();
    renderDialog({ mode: 'create', type: 'meeting', groupId: 'g1' });
    await screen.findByRole('heading', { name: t('knowledge.detail.new.meeting') });
    await user.type(screen.getByLabelText(t('knowledge.form.title')), 'Weekly');
    const repeat = screen.getByLabelText(t('knowledge.meeting.repeat.label'));
    expect(screen.getByRole('option', { name: t('knowledge.meeting.repeat.none') })).toBeVisible();
    await user.selectOptions(repeat, 'biweekly');
    await user.selectOptions(screen.getByLabelText(t('knowledge.meeting.repeat.ends')), 'count');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.create') }));
    expect(createKnowledge).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        meeting: expect.objectContaining({
          repeat: expect.objectContaining({ frequency: 'biweekly', count: 10 }),
        }),
      }),
    );
  });
});

describe('recurring calls (ADR 0049): a call of a series', () => {
  it('shows the series and asks "only this" or "this and following" on save', async () => {
    current = meeting({}, { series: SERIES });
    vi.mocked(updateKnowledge).mockResolvedValue(current);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('heading', { name: 'Kickoff' });
    expect(screen.getByTestId('meeting-series')).toHaveTextContent(
      t('knowledge.meeting.series.count', { count: 5 }),
    );
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    const title = screen.getByLabelText(t('knowledge.form.title'));
    await user.clear(title);
    await user.type(title, 'Renamed');
    // An existing call never offers "Repeat".
    expect(screen.queryByLabelText(t('knowledge.meeting.repeat.label'))).toBeNull();
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.save') }));
    expect(updateKnowledge).not.toHaveBeenCalled();
    expect(screen.getByText(t('knowledge.meeting.series.editScope'))).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: t('knowledge.meeting.series.thisAndFollowing') }),
    );
    expect(updateKnowledge).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ title: 'Renamed', seriesScope: 'following' }),
    );
  });

  it('"Only this meeting" saves without the scope', async () => {
    current = meeting({}, { series: SERIES });
    vi.mocked(updateKnowledge).mockResolvedValue(current);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('heading', { name: 'Kickoff' });
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    await user.type(screen.getByLabelText(t('knowledge.form.title')), '!');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.save') }));
    await user.click(screen.getByRole('button', { name: t('knowledge.meeting.series.onlyThis') }));
    expect(updateKnowledge).toHaveBeenCalledWith(
      'k1',
      expect.not.objectContaining({ seriesScope: expect.anything() }),
    );
  });

  it('delete offers this call or this and the following', async () => {
    current = meeting({}, { series: SERIES });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('heading', { name: 'Kickoff' });
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('knowledge.detail.delete') }));
    await user.click(
      screen.getByRole('button', { name: t('knowledge.meeting.series.deleteFollowing') }),
    );
    await waitFor(() => expect(deleteKnowledge).toHaveBeenCalledWith('k1', 'following'));
  });
});
