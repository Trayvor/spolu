import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, KnowledgeItemDto, KnowledgeType } from '@spolu/shared';
import { uploadFile } from '@/features/files/upload';
import { i18n } from '@/i18n';
import {
  KnowledgeForm,
  emptyKnowledgeValue,
  fromItem,
  toDraft,
  toPatch,
  validateKnowledge,
  type KnowledgeFormErrors,
  type KnowledgeFormValue,
} from './knowledge-form';
import { localToIso } from '@/features/reminders/reminder-times-field';

vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true },
];

const PDF: FileInfo = {
  id: 'f1',
  name: 'grant.budget.pdf',
  mime: 'application/pdf',
  size: 1024,
  width: null,
  height: null,
  hasPreview: false,
};

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function Harness({
  type,
  initial = emptyKnowledgeValue(),
  errors,
  canChooseVisibility = false,
  visibilityLocked = false,
}: {
  type: KnowledgeType;
  initial?: KnowledgeFormValue;
  errors?: KnowledgeFormErrors;
  canChooseVisibility?: boolean;
  visibilityLocked?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [files, setFiles] = useState<FileInfo[]>([]);
  return (
    <KnowledgeForm
      value={value}
      onChange={setValue}
      groupId="g1"
      type={type}
      errors={errors}
      files={files}
      onFilesChange={setFiles}
      canChooseVisibility={canChooseVisibility}
      visibilityLocked={visibilityLocked}
      authorId="u2"
    />
  );
}

function renderForm(props: Parameters<typeof Harness>[0]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PEOPLE), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), container: view.container };
}

/** The labelled fields in document order, by their label text. */
function fieldOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll('label, legend, [data-field-label]')).map(
    (el) => el.textContent,
  );
}

describe('KnowledgeForm', () => {
  it('fields per type in order', () => {
    const file = renderForm({ type: 'file' });
    expect(fieldOrder(file.container).slice(0, 3)).toEqual([
      t('knowledge.form.file'),
      t('knowledge.form.title'),
      t('knowledge.form.description'),
    ]);
    file.container.remove();

    const link = renderForm({ type: 'link' });
    expect(fieldOrder(link.container).slice(0, 3)).toEqual([
      t('knowledge.form.url'),
      t('knowledge.form.title'),
      t('knowledge.form.description'),
    ]);
    link.container.remove();

    const note = renderForm({ type: 'note' });
    expect(fieldOrder(note.container)).toEqual([
      t('knowledge.form.title'),
      t('knowledge.form.body'),
      t('knowledge.form.files'),
    ]);
    note.container.remove();

    const reminder = renderForm({ type: 'reminder' });
    expect(fieldOrder(reminder.container)).toEqual([
      t('knowledge.form.title'),
      t('knowledge.form.body'),
      t('reminders.fields.times'),
      t('reminders.fields.recipients'),
    ]);
  });

  it('picking a file fills an empty title without extension and keeps a typed one', async () => {
    vi.mocked(uploadFile).mockResolvedValue(PDF);
    const { user, container } = renderForm({ type: 'file' });
    const input = screen.getByTestId('knowledge-file-input');
    await user.upload(input, new File(['x'], 'grant.budget.pdf', { type: 'application/pdf' }));
    await waitFor(() =>
      expect(screen.getByLabelText(t('knowledge.form.title'))).toHaveValue('grant.budget'),
    );
    container.remove();

    const typed = renderForm({
      type: 'file',
      initial: { ...emptyKnowledgeValue(), title: 'Mine' },
    });
    await typed.user.upload(
      screen.getByTestId('knowledge-file-input'),
      new File(['x'], 'grant.budget.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t('forms.files.remove', { name: PDF.name }) }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(t('knowledge.form.title'))).toHaveValue('Mine');
  });

  it('visibility control only for admins', async () => {
    const client = renderForm({ type: 'note' });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    client.container.remove();

    const { user } = renderForm({ type: 'note', canChooseVisibility: true });
    const group = screen.getByRole('radiogroup', { name: t('knowledge.form.visibleTo') });
    expect(group).toBeInTheDocument();
    const everyone = screen.getByRole('radio', { name: t('knowledge.visibility.public') });
    const admins = screen.getByRole('radio', { name: t('knowledge.visibility.admins') });
    expect(everyone).toHaveAttribute('aria-checked', 'true');
    await user.click(admins);
    expect(admins).toHaveAttribute('aria-checked', 'true');
    expect(everyone).toHaveAttribute('aria-checked', 'false');
  });

  it('locked visibility is disabled with the hint', () => {
    renderForm({ type: 'note', canChooseVisibility: true, visibilityLocked: true });
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    const hint = screen.getByText(t('knowledge.form.visibilityLocked'));
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-describedby', hint.id);
  });
});

describe('validateKnowledge', () => {
  const now = new Date('2026-10-16T10:00:00');
  const base = { ...emptyKnowledgeValue(), title: 'Checklist' };

  it('required title, http(s) url, file item needs one file, reminder needs a time a minute ahead', () => {
    expect(validateKnowledge('note', { ...base, title: '  ' }, now).title).toBe(
      t('knowledge.form.errors.titleRequired'),
    );
    expect(validateKnowledge('note', base, now)).toEqual({});

    expect(validateKnowledge('link', { ...base, url: '' }, now).url).toBe(
      t('knowledge.form.errors.urlRequired'),
    );
    expect(validateKnowledge('link', { ...base, url: 'javascript:alert(1)' }, now).url).toBe(
      t('knowledge.form.errors.urlInvalid'),
    );
    expect(validateKnowledge('link', { ...base, url: 'https://egrant.sk' }, now)).toEqual({});

    expect(validateKnowledge('file', base, now).file).toBe(t('knowledge.form.errors.fileRequired'));
    expect(validateKnowledge('file', { ...base, fileIds: ['f1'] }, now)).toEqual({});

    const at = (time: string) => ({ date: '2026-10-16', time, firedAt: null });
    expect(validateKnowledge('reminder', { ...base, times: [] }, now).times).toBe(
      t('knowledge.form.errors.timesRequired'),
    );
    expect(validateKnowledge('reminder', { ...base, times: [at('10:00')] }, now).times).toBe(
      t('knowledge.form.errors.timesInvalid'),
    );
    expect(validateKnowledge('reminder', { ...base, times: [at('10:02')] }, now)).toEqual({});
    // A fired time in the past is fine.
    expect(
      validateKnowledge(
        'reminder',
        {
          ...base,
          times: [
            { id: 't0', date: '2026-10-01', time: '09:00', firedAt: '2026-10-01T07:00:00Z' },
            at('11:00'),
          ],
        },
        now,
      ),
    ).toEqual({});
  });
});

describe('toDraft and toPatch', () => {
  const item: KnowledgeItemDto = {
    id: 'k1',
    groupId: 'g1',
    type: 'reminder',
    visibility: 'public',
    title: 'Report',
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 1,
    lastReminderAt: null,
    createdBy: { id: 'u2', name: 'Boris Kováč' },
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    body: 'Send the report',
    files: [],
    reminder: {
      times: [
        { id: 't1', at: '2026-10-05T07:00:30.000Z', firedAt: '2026-10-05T07:00:31.000Z' },
        { id: 't2', at: '2030-01-02T08:00:00.000Z', firedAt: null },
      ],
      recipients: [
        { user: { id: 'u2', name: 'Boris Kováč' }, source: 'author' },
        { user: { id: 'u1', name: 'Anna Nováková' }, source: 'added' },
      ],
      subscribed: true,
      canEdit: true,
    },
    canEdit: true,
    visibilityLocked: false,
  };

  it('toPatch sends only changed fields plus updatedAt', () => {
    const value = fromItem(item);
    expect(toPatch(item, value)).toEqual({ updatedAt: item.updatedAt });
    expect(toPatch(item, { ...value, title: 'New title' })).toEqual({
      title: 'New title',
      updatedAt: item.updatedAt,
    });
  });

  it('toPatch sends a fired time with its original at', () => {
    const value = fromItem(item);
    const patch = toPatch(item, {
      ...value,
      times: [...value.times, { date: '2030-02-01', time: '09:00', firedAt: null }],
    });
    expect(patch.reminder?.times).toEqual([
      { id: 't1', at: '2026-10-05T07:00:30.000Z' },
      { id: 't2', at: '2030-01-02T08:00:00.000Z' },
      { at: localToIso('2030-02-01', '09:00') },
    ]);
    expect(patch.reminder?.recipientIds).toEqual(['u2', 'u1']);
    expect(patch.title).toBeUndefined();
  });

  it('toDraft builds the fields of the type', () => {
    const value: KnowledgeFormValue = {
      ...emptyKnowledgeValue(),
      title: ' Site ',
      url: ' https://egrant.sk ',
      fileIds: ['f1'],
    };
    expect(toDraft('link', value)).toEqual({
      type: 'link',
      title: 'Site',
      body: '',
      url: 'https://egrant.sk',
      fileIds: [],
      visibility: 'public',
    });
    expect(emptyKnowledgeValue().times).toEqual([
      { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: '09:00', firedAt: null },
    ]);
  });
});
