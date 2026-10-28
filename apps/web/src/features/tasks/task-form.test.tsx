import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, TaskDraft } from '@spolu/shared';
import { ErrorCodes } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { uploadFile } from '@/features/files/upload';
import { i18n, setLanguage } from '@/i18n';
import { TaskForm, validateTaskDraft, EMPTY_TASK_DRAFT, type TaskFormErrors } from './task-form';

vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true, isManager: true },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${String.fromCharCode(67 + i)}`,
    isAdmin: false,
    isManager: false,
  })),
];

const FILE: FileInfo = {
  id: 'f1',
  name: 'brief.pdf',
  mime: 'application/pdf',
  size: 1024,
  width: null,
  height: null,
  hasPreview: false,
};

function Harness({
  initial = EMPTY_TASK_DRAFT,
  errors,
  initialFiles = [],
  known,
  onValue,
  slot,
  linkWarning,
}: {
  slot?: ReactNode;
  linkWarning?: boolean;
  initial?: TaskDraft;
  errors?: TaskFormErrors;
  initialFiles?: FileInfo[];
  known?: { id: string; name: string }[];
  onValue?: (v: TaskDraft) => void;
}) {
  const [value, setValue] = useState(initial);
  const [files, setFiles] = useState(initialFiles);
  return (
    <TaskForm
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      groupId="g1"
      errors={errors}
      files={files}
      onFilesChange={setFiles}
      knownPeople={known}
      remindersSlot={slot}
      linkWarning={linkWarning}
    />
  );
}

function renderForm(props: Parameters<typeof Harness>[0] = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PEOPLE), { status: 200 })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const t = (key: string, opts?: Record<string, string>) => i18n.t(key, opts);

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: t('tasks.form.assignees') }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('TaskForm', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('remindersSlot renders between the urgent switch and the files', () => {
    renderForm({ slot: <p>reminders here</p> });
    const slot = screen.getByText('reminders here');
    const urgent = screen.getByRole('switch', { name: t('tasks.form.urgent') });
    const files = screen.getByText(t('tasks.form.files'));
    expect(urgent.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('typing in title calls onChange with the new value and keeps the rest', async () => {
    const onValue = vi.fn();
    const user = renderForm({ initial: { ...EMPTY_TASK_DRAFT, urgent: true }, onValue });
    await user.type(screen.getByLabelText('Title'), 'A');
    expect(onValue).toHaveBeenLastCalledWith({ ...EMPTY_TASK_DRAFT, urgent: true, title: 'A' });
  });

  it("choosing a person adds their id; the chip's Remove deletes it", async () => {
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    await choose(user, 'Boris');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeIds: ['u2'] }));
    expect(screen.getByText('eGrant')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Boris Kováč' }));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeIds: [] }));
  });

  it('picks with the keyboard', async () => {
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    await user.type(
      await screen.findByRole('combobox', { name: t('tasks.form.assignees') }),
      'ann{Enter}',
    );
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeIds: ['u1'] }));
  });

  it('an assignee not in useGroupPeople shows "Name (removed)"', async () => {
    renderForm({
      initial: { ...EMPTY_TASK_DRAFT, assigneeIds: ['gone'] },
      known: [{ id: 'gone', name: 'Old Timer' }],
    });
    expect(await screen.findByText('Old Timer (removed)')).toBeInTheDocument();
  });

  it('the 11th person cannot be chosen, but the field keeps focus and explains why', async () => {
    const user = renderForm({
      initial: { ...EMPTY_TASK_DRAFT, assigneeIds: PEOPLE.slice(0, 10).map((p) => p.id) },
    });
    const combobox = screen.getByRole('combobox', { name: t('tasks.form.assignees') });
    expect(combobox).not.toBeDisabled();
    expect(combobox).toHaveAttribute('readonly');
    expect(combobox).toHaveAccessibleDescription(i18n.t('forms.people.full', { max: 10 }));
    await user.click(combobox);
    expect(combobox).toHaveFocus();
    // The Project select's own options do not count.
    expect(screen.queryByRole('option', { name: /Person|Anna|Boris/ })).not.toBeInTheDocument();
  });

  it('picking the 10th person keeps the keyboard focus on the field', async () => {
    const user = renderForm({
      initial: { ...EMPTY_TASK_DRAFT, assigneeIds: PEOPLE.slice(0, 9).map((p) => p.id) },
    });
    const combobox = screen.getByRole('combobox', { name: t('tasks.form.assignees') });
    await user.click(combobox);
    await screen.findAllByRole('option');
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(10);
    expect(combobox).toHaveFocus();
  });

  it('the urgent switch toggles value.urgent and aria-checked', async () => {
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    const toggle = screen.getByRole('switch', { name: 'Urgent' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ urgent: true }));
  });

  it('clearing the date sets dueDate null', async () => {
    const onValue = vi.fn();
    const user = renderForm({ initial: { ...EMPTY_TASK_DRAFT, dueDate: '2026-11-01' }, onValue });
    const date = screen.getByLabelText('Deadline');
    expect(date).toHaveValue('2026-11-01');
    await user.clear(date);
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: null }));
  });

  it("validateTaskDraft returns titleRequired for '  ' and titleTooLong for 201 chars", () => {
    expect(validateTaskDraft({ ...EMPTY_TASK_DRAFT, title: '  ' }).title).toBe(
      t('tasks.form.errors.titleRequired'),
    );
    expect(validateTaskDraft({ ...EMPTY_TASK_DRAFT, title: 'x'.repeat(201) }).title).toBe(
      t('tasks.form.errors.titleTooLong'),
    );
    expect(
      validateTaskDraft({
        ...EMPTY_TASK_DRAFT,
        title: 'ok',
        assigneeIds: Array.from({ length: 11 }, (_, i) => `u${i}`),
      }).assigneeIds,
    ).toBe(i18n.t('forms.people.full', { max: 10 }));
    expect(validateTaskDraft({ ...EMPTY_TASK_DRAFT, title: 'ok' })).toEqual({});
  });

  it('errors prop shows the message under the field with aria-describedby', () => {
    renderForm({ errors: { title: 'Enter a title.' } });
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const message = screen.getByText('Enter a title.');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('removing a file removes its id from fileIds', async () => {
    const onValue = vi.fn();
    const user = renderForm({
      initial: { ...EMPTY_TASK_DRAFT, fileIds: ['f1'] },
      initialFiles: [FILE],
      onValue,
    });
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('brief.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove brief.pdf' }));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ fileIds: [] }));
    expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument();
  });

  it('validateTaskDraft never returns {} for an invalid draft', () => {
    const base = { ...EMPTY_TASK_DRAFT, title: 'ok' };
    expect(
      validateTaskDraft({ ...base, fileIds: Array.from({ length: 21 }, (_, i) => `f${i}`) }).form,
    ).toBe(t('tasks.form.errors.tooManyFiles'));
    expect(validateTaskDraft({ ...base, dueDate: '2026-13-45' }).form).toBe(
      t('tasks.form.errors.invalidDate'),
    );
    expect(validateTaskDraft({ ...base, description: 'x'.repeat(10_001) }).description).toBe(
      t('tasks.form.errors.descriptionTooLong'),
    );
  });

  it('the link is a URL field; typing sets it, clearing sets null', async () => {
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    const link = screen.getByRole('textbox', { name: t('tasks.form.link') });
    expect(link).toHaveAttribute('type', 'url');
    expect(link).toHaveAttribute('placeholder', t('tasks.form.linkPlaceholder'));
    await user.type(link, 'https://e.sk');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ link: 'https://e.sk' }));
    await user.clear(link);
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ link: null }));
  });

  it('a valid link shows an "Open link" anchor in a new tab; an invalid one does not', () => {
    renderForm({ initial: { ...EMPTY_TASK_DRAFT, link: 'https://egrant.sk/projekt' } });
    const open = screen.getByRole('link', { name: new RegExp(t('tasks.form.openLink')) });
    expect(open).toHaveAttribute('href', 'https://egrant.sk/projekt');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no anchor for a link that is not http(s)', () => {
    renderForm({ initial: { ...EMPTY_TASK_DRAFT, link: 'javascript:alert(1)' } });
    expect(screen.queryByRole('link', { name: new RegExp(t('tasks.form.openLink')) })).toBeNull();
  });

  it('validateTaskDraft reports a link that is not an http(s) URL on the link field', () => {
    const base = { ...EMPTY_TASK_DRAFT, title: 'ok' };
    expect(validateTaskDraft({ ...base, link: 'ftp://e.sk/a' }).link).toBe(
      t('tasks.form.errors.invalidLink'),
    );
    expect(validateTaskDraft({ ...base, link: 'https://e.sk' })).toEqual({});
    expect(validateTaskDraft({ ...base, link: null })).toEqual({});
  });

  it('linkWarning shows the empty-link warning under the field, described by it', () => {
    renderForm({ linkWarning: true });
    const warning = screen.getByText(t('tasks.form.linkEmptyWarning'));
    expect(
      screen.getByRole('textbox', { name: t('tasks.form.link') }).getAttribute('aria-describedby'),
    ).toBe(warning.id);
  });

  it('a file id without details shows a removable fallback chip', async () => {
    const onValue = vi.fn();
    const user = renderForm({ initial: { ...EMPTY_TASK_DRAFT, fileIds: ['zz'] }, onValue });
    expect(screen.getByText('File')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove File' }));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ fileIds: [] }));
  });
});

describe('TaskForm description', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  // The editor itself is tested in `features/editor/description-field.test.tsx`.
  it('shows a saved description rendered like a chat message until Edit, then the editor', async () => {
    const user = renderForm({
      initial: { ...EMPTY_TASK_DRAFT, description: 'Check **totals**' },
    });
    expect(screen.getByText('totals').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    const box = await screen.findByRole('textbox', { name: 'Description' });
    expect(box).toHaveTextContent('Check totals');
    expect(
      screen.getByRole('toolbar', { name: t('chat.composer.formatting') }),
    ).toBeInTheDocument();
  });

  it('a new task opens its description in the editor', async () => {
    renderForm();
    expect(await screen.findByRole('textbox', { name: 'Description' })).toBeInTheDocument();
  });
});

describe('TaskForm layout', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('gives the title the same label gap as the other fields, so its focus ring has room', () => {
    renderForm();
    const title = screen.getByLabelText('Title');
    const deadline = screen.getByLabelText('Deadline');
    // 10 px, as on egrant.sk: the 5 px focus ring (2 px + 3 px offset) never touches the label.
    expect(title.parentElement).toHaveClass('flex', 'flex-col', 'gap-2.5');
    expect(deadline.parentElement).toHaveClass('flex', 'flex-col', 'gap-2.5');
  });

  it('puts the Deadline label above its field and the urgent switch on its own row', () => {
    renderForm();
    const field = screen.getByLabelText('Deadline');
    const label = screen.getByText('Deadline', { selector: 'label' });
    // Label and field stack in one column, with the gap every other field uses.
    expect(field.parentElement).toBe(label.parentElement);
    expect(field.parentElement).toHaveClass('flex', 'flex-col', 'gap-2.5');
    // The switch is a row of the form's own column, not beside the date.
    const form = field.parentElement!.parentElement!;
    expect(form).toHaveClass('space-y-5');
    const urgent = screen.getByRole('switch', { name: 'Urgent' });
    const urgentRow = [...form.children].find((row) => row.contains(urgent));
    expect(urgentRow).toBeDefined();
    expect(urgentRow).not.toBe(field.parentElement);
  });
});

describe('TaskForm file uploads', () => {
  const upload = vi.mocked(uploadFile);
  const info = (id: string): FileInfo => ({ ...FILE, id, name: `${id}.pdf` });
  const pick = (user: ReturnType<typeof userEvent.setup>, ...names: string[]) =>
    user.upload(
      screen.getByTestId('task-file-input'),
      names.map((n) => new File(['x'], n)),
    );

  beforeEach(async () => {
    await setLanguage('en');
    upload.mockReset();
  });

  it('shows progress, then adds the file and its id', async () => {
    let finish!: (f: FileInfo) => void;
    upload.mockImplementation((_g, _f, onProgress) => {
      onProgress?.(0.5);
      return new Promise((resolve) => (finish = resolve));
    });
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    await pick(user, 'a.pdf');
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '0.5');
    await act(async () => finish(info('fa')));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ fileIds: ['fa'] }));
    expect(screen.getByText('fa.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('two uploads finishing together both land', async () => {
    const finishers: ((f: FileInfo) => void)[] = [];
    upload.mockImplementation(() => new Promise((resolve) => finishers.push(resolve)));
    const onValue = vi.fn();
    const user = renderForm({ onValue });
    await pick(user, 'a.pdf', 'b.pdf');
    await act(async () => {
      finishers[0]!(info('fa'));
      finishers[1]!(info('fb'));
    });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ fileIds: ['fa', 'fb'] }));
    expect(screen.getByText('fa.pdf')).toBeInTheDocument();
    expect(screen.getByText('fb.pdf')).toBeInTheDocument();
  });

  it('shows an error for a failed upload and a specific one for a file that is too large', async () => {
    upload.mockRejectedValueOnce(new ApiError('x', 500));
    upload.mockRejectedValueOnce(new ApiError('x', 413, { error: ErrorCodes.fileTooLarge }));
    const user = renderForm();
    await pick(user, 'a.pdf');
    expect(await screen.findByText('Could not upload a.pdf.')).toBeInTheDocument();
    await pick(user, 'b.pdf');
    expect(await screen.findByText('b.pdf is over 25 MB.')).toBeInTheDocument();
    expect(screen.queryByText('Could not upload a.pdf.')).not.toBeInTheDocument();
  });

  it('disables Attach at 20 files and never starts a 21st upload', async () => {
    const ids = Array.from({ length: 19 }, (_, i) => `f${i}`);
    upload.mockResolvedValue(info('last'));
    const user = renderForm({ initial: { ...EMPTY_TASK_DRAFT, fileIds: ids } });
    await pick(user, 'a.pdf', 'b.pdf');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Attach a file' })).toBeDisabled();
  });
});

describe('two TaskForms on one screen', () => {
  it('keep independent state and unique ids', async () => {
    await setLanguage('en');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(PEOPLE), { status: 200 })),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
        <Harness />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const [first, second] = screen.getAllByLabelText('Title');
    expect(first!.id).not.toBe(second!.id);
    await user.type(first!, 'One');
    expect(first).toHaveValue('One');
    expect(second).toHaveValue('');
    const switches = screen.getAllByRole('switch', { name: 'Urgent' });
    await user.click(switches[0]!);
    expect(switches[0]).toHaveAttribute('aria-checked', 'true');
    expect(switches[1]).toHaveAttribute('aria-checked', 'false');
  });
});

describe('TaskForm project and event (Phase 33)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  const PICKER = [
    { id: 'p1', name: 'Culture 2026', color: 'blue', status: 'active', isTest: false },
    { id: 'p2', name: 'Sport', color: 'pink', status: 'active', isTest: false },
    { id: 'p3', name: 'Old one', color: 'green', status: 'archived', isTest: false },
  ];
  const EVENTS = [
    { id: 'e1', name: 'Kickoff', occursOn: '2099-11-04', source: 'manual' },
    { id: 'e0', name: 'Call', occursOn: '2000-01-02', source: 'manual' },
  ];

  function renderWithProjects(initial: TaskDraft = EMPTY_TASK_DRAFT) {
    const fetchMock = vi.fn(async (url: string) => {
      const body =
        url === '/api/groups/g1/projects/picker'
          ? PICKER
          : url.startsWith('/api/projects/')
            ? EVENTS
            : PEOPLE;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const values: TaskDraft[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness initial={initial} onValue={(v) => values.push(v)} />
      </QueryClientProvider>,
    );
    const urls = () => fetchMock.mock.calls.map(([url]) => url);
    return { user: userEvent.setup(), values, urls };
  }

  it('loads the projects with the form; choosing one shows the Event select', async () => {
    const { user, values } = renderWithProjects();
    const project = screen.getByRole('combobox', { name: t('tasks.form.project') });
    expect(screen.queryByRole('combobox', { name: t('tasks.form.event') })).toBeNull();
    await user.click(project);
    expect(await screen.findByRole('option', { name: 'Culture 2026' })).toBeInTheDocument();
    // Archived projects are not offered.
    expect(screen.queryByRole('option', { name: /Old one/ })).toBeNull();
    await user.selectOptions(project, 'p1');
    expect(values.at(-1)).toMatchObject({ projectId: 'p1', eventId: null });
    const event = screen.getByRole('combobox', { name: t('tasks.form.event') });
    await user.click(event);
    const options = await screen.findAllByRole('option', { name: /Kickoff|Call/ });
    // Coming events first, then the past ones.
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['e1', 'e0']);
    await user.selectOptions(event, 'e1');
    expect(values.at(-1)).toMatchObject({ projectId: 'p1', eventId: 'e1' });
  });

  it('changing the project clears the event; No project clears both', async () => {
    const { user, values } = renderWithProjects({
      ...EMPTY_TASK_DRAFT,
      projectId: 'p1',
      eventId: 'e1',
    });
    const project = screen.getByRole('combobox', { name: t('tasks.form.project') });
    await user.click(project);
    await screen.findByRole('option', { name: 'Sport' });
    await user.selectOptions(project, 'p2');
    expect(values.at(-1)).toMatchObject({ projectId: 'p2', eventId: null });
    await user.selectOptions(project, '');
    expect(values.at(-1)).toMatchObject({ projectId: null, eventId: null });
    expect(screen.queryByRole('combobox', { name: t('tasks.form.event') })).toBeNull();
  });
});
