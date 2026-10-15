import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, TaskDraft } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { TaskForm, validateTaskDraft, EMPTY_TASK_DRAFT, type TaskFormErrors } from './task-form';

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${String.fromCharCode(67 + i)}`,
    isAdmin: false,
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
}: {
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
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('TaskForm', () => {
  beforeEach(async () => {
    await setLanguage('en');
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
    await user.type(await screen.findByRole('combobox'), 'ann{Enter}');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeIds: ['u1'] }));
  });

  it('an assignee not in useGroupPeople shows "Name (removed)"', async () => {
    renderForm({
      initial: { ...EMPTY_TASK_DRAFT, assigneeIds: ['gone'] },
      known: [{ id: 'gone', name: 'Old Timer' }],
    });
    expect(await screen.findByText('Old Timer (removed)')).toBeInTheDocument();
  });

  it('the 11th person cannot be chosen', async () => {
    const user = renderForm({
      initial: { ...EMPTY_TASK_DRAFT, assigneeIds: PEOPLE.slice(0, 10).map((p) => p.id) },
    });
    expect(screen.getByRole('combobox')).toBeDisabled();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
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
    ).toBe(t('tasks.form.errors.tooManyAssignees'));
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
});
