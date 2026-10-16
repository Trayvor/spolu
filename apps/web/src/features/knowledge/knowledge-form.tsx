import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KNOWLEDGE_LIMITS,
  Visibilities,
  isHttpUrl,
  type FileInfo,
  type GroupPerson,
  type KnowledgeDraft,
  type KnowledgeItemDto,
  type KnowledgePatch,
  type KnowledgeType,
  type ReminderInput,
  type Visibility,
} from '@spolu/shared';
import { i18n } from '@/i18n';
import { FilesField } from '@/components/files-field';
import { FormattedTextField } from '@/components/formatted-text-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { RecipientsField } from '@/features/reminders/recipients-field';
import {
  ReminderTimesField,
  isoToLocal,
  localDate,
  localToIso,
  newRowKey,
  type ReminderTimeValue,
} from '@/features/reminders/reminder-times-field';

export type { ReminderTimeValue };

export type KnowledgeFormValue = {
  title: string;
  body: string;
  url: string;
  fileIds: string[];
  visibility: Visibility;
  times: ReminderTimeValue[];
  recipientIds: string[];
};

export type KnowledgeFormErrors = Partial<
  Record<'title' | 'url' | 'file' | 'body' | 'times' | 'recipients' | 'form', string>
>;

/** A new item's values: one reminder time, tomorrow at 09:00. */
export function emptyKnowledgeValue(): KnowledgeFormValue {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    title: '',
    body: '',
    url: '',
    fileIds: [],
    visibility: 'public',
    times: [{ key: newRowKey(), date: localDate(tomorrow), time: '09:00', firedAt: null }],
    recipientIds: [],
  };
}

/** The form values of an existing item; the recipients are the author and the added people. */
export function fromItem(item: KnowledgeItemDto): KnowledgeFormValue {
  return {
    title: item.title,
    body: item.body,
    url: item.url ?? '',
    fileIds: item.files.map((f) => f.id),
    visibility: item.visibility,
    times: (item.reminder?.times ?? []).map((time) => ({
      id: time.id,
      ...isoToLocal(time.at),
      firedAt: time.firedAt,
    })),
    recipientIds: (item.reminder?.recipients ?? [])
      .filter((r) => r.source !== 'subscribed')
      .map((r) => r.user.id),
  };
}

/**
 * The recipients an item of `visibility` may have: for an admins-only item, the author and the
 * people `people` confirms are admins; otherwise all of them. While `people` is not loaded all
 * are kept, so a quick save never drops recipients silently: the server keeps or refuses them.
 */
export function allowedRecipients(
  ids: string[],
  visibility: Visibility,
  people: GroupPerson[] | undefined,
  authorId: string | undefined,
): string[] {
  if (visibility !== 'admins' || people === undefined) return ids;
  return ids.filter((id) => id === authorId || people?.find((p) => p.id === id)?.isAdmin === true);
}

/**
 * What submitting needs besides the values: the group people, to filter recipients, and for a
 * new item the folder it goes into (null or absent: the top level).
 */
export type SubmitContext = {
  people: GroupPerson[] | undefined;
  authorId?: string;
  folderId?: string | null;
};

/** The reminder part sent to the server. A fired time keeps its original `at`. */
function reminderInput(
  value: KnowledgeFormValue,
  item?: KnowledgeItemDto,
  context?: SubmitContext,
): ReminderInput {
  const original = new Map((item?.reminder?.times ?? []).map((time) => [time.id, time.at]));
  return {
    times: value.times.map((time) => {
      const at =
        time.firedAt !== null && time.id && original.has(time.id)
          ? original.get(time.id)!
          : localToIso(time.date, time.time);
      return time.id ? { id: time.id, at } : { at };
    }),
    recipientIds: context
      ? allowedRecipients(value.recipientIds, value.visibility, context.people, context.authorId)
      : value.recipientIds,
  };
}

/**
 * A new item of `type` from the form values. An admins-only reminder keeps only the author and
 * confirmed admins of `context.people` as recipients.
 */
export function toDraft(
  type: KnowledgeType,
  value: KnowledgeFormValue,
  context: SubmitContext,
): KnowledgeDraft {
  const base = {
    title: value.title.trim(),
    body: value.body,
    visibility: value.visibility,
    folderId: context.folderId ?? null,
  };
  switch (type) {
    case 'note':
    case 'file':
      return { ...base, type, fileIds: value.fileIds };
    case 'link':
      return { ...base, type, url: value.url.trim(), fileIds: [] };
    case 'reminder':
      return { ...base, type, reminder: reminderInput(value, undefined, context), fileIds: [] };
    case 'chat_file':
      throw new Error('A chat file comes only from a chat');
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * An edit of `item`: only the changed fields of its type, plus the `updatedAt` it was loaded at.
 * Recipients are filtered as in `toDraft`, with the item's author.
 */
export function toPatch(
  item: KnowledgeItemDto,
  value: KnowledgeFormValue,
  context: Omit<SubmitContext, 'authorId'>,
): KnowledgePatch {
  const before = fromItem(item);
  const patch: KnowledgePatch = { updatedAt: item.updatedAt };
  if (value.title.trim() !== before.title) patch.title = value.title.trim();
  if (value.body !== before.body) patch.body = value.body;
  if (value.visibility !== before.visibility) patch.visibility = value.visibility;
  if (item.type === 'link' && value.url.trim() !== before.url) patch.url = value.url.trim();
  if ((item.type === 'note' || item.type === 'file') && !same(value.fileIds, before.fileIds)) {
    patch.fileIds = value.fileIds;
  }
  if (item.type === 'reminder') {
    const next = reminderInput(value, item, { ...context, authorId: item.createdBy.id });
    if (!same(next, reminderInput(before, item))) patch.reminder = next;
  }
  return patch;
}

/** The smallest lead of a new reminder time, and the largest (5 years), as the server checks. */
const MIN_LEAD_MS = 60_000;
const MAX_YEARS = 5;

/** Errors per unfired time row, by index (fired times are never checked). */
export function validateTimes(
  times: ReminderTimeValue[],
  now: Date = new Date(),
): Record<number, string> {
  const errors: Record<number, string> = {};
  const latest = new Date(now);
  latest.setFullYear(latest.getFullYear() + MAX_YEARS);
  const seen = new Set<number>();
  times.forEach((time, index) => {
    const iso = localToIso(time.date, time.time);
    const at = iso ? Date.parse(iso) : NaN;
    if (time.firedAt === null) {
      if (Number.isNaN(at)) errors[index] = i18n.t('reminders.fields.errors.incomplete');
      else if (at < now.getTime() + MIN_LEAD_MS)
        errors[index] = i18n.t('reminders.fields.errors.passed');
      else if (at > latest.getTime()) errors[index] = i18n.t('reminders.fields.errors.tooFar');
      else if (seen.has(at)) errors[index] = i18n.t('reminders.fields.errors.duplicate');
    }
    if (!Number.isNaN(at)) seen.add(at);
  });
  return errors;
}

/** Checks the fields of `type` and returns translated messages per field. */
export function validateKnowledge(
  type: KnowledgeType,
  value: KnowledgeFormValue,
  now: Date = new Date(),
): KnowledgeFormErrors {
  const errors: KnowledgeFormErrors = {};
  const title = value.title.trim();
  if (!title) errors.title = i18n.t('knowledge.form.errors.titleRequired');
  else if (title.length > KNOWLEDGE_LIMITS.title) {
    errors.title = i18n.t('knowledge.form.errors.titleTooLong');
  }
  if (value.body.length > KNOWLEDGE_LIMITS.body) {
    errors.body = i18n.t('knowledge.form.errors.bodyTooLong');
  }
  if (type === 'link') {
    const url = value.url.trim();
    if (!url) errors.url = i18n.t('knowledge.form.errors.urlRequired');
    else if (!isHttpUrl(url)) errors.url = i18n.t('knowledge.form.errors.urlInvalid');
  }
  if (type === 'file' && value.fileIds.length !== 1) {
    errors.file = i18n.t('knowledge.form.errors.fileRequired');
  }
  if (type === 'reminder') {
    if (value.times.length === 0) errors.times = i18n.t('knowledge.form.errors.timesRequired');
    else if (Object.keys(validateTimes(value.times, now)).length > 0) {
      errors.times = i18n.t('knowledge.form.errors.timesInvalid');
    }
    if (value.recipientIds.length > KNOWLEDGE_LIMITS.recipients) {
      errors.recipients = i18n.t('forms.people.full', { max: KNOWLEDGE_LIMITS.recipients });
    }
  }
  return errors;
}

/** A file name without its last extension ("budget.v2.pdf" → "budget.v2"). */
function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

const FIELD = 'flex flex-col gap-2.5';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-tiny text-error-ink">
      {message}
    </p>
  );
}

/**
 * "Visible to": two pills in a track, the chosen one ink. A radio group: arrows move the choice.
 */
export function VisibilityControl({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
  disabled: boolean;
  hint?: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = Visibilities.indexOf(value);
    const next = (index + step + Visibilities.length) % Visibilities.length;
    onChange(Visibilities[next]!);
    refs.current[next]?.focus();
  };

  return (
    <div className={FIELD}>
      <span id={`${uid}-label`} data-field-label className="text-button font-semibold">
        {t('knowledge.form.visibleTo')}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${uid}-label`}
        aria-describedby={hint ? `${uid}-hint` : undefined}
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full self-start rounded-full bg-secondary p-1"
      >
        {Visibilities.map((option, i) => {
          const checked = option === value;
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                'h-8 min-w-0 truncate rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) disabled:cursor-not-allowed',
                checked
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-surface-3 disabled:hover:bg-transparent',
                disabled && !checked && 'text-muted-foreground',
              )}
            >
              {t(`knowledge.visibility.${option}`)}
            </button>
          );
        })}
      </div>
      {hint && (
        <p id={`${uid}-hint`} className="text-tiny text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * The fields of a knowledge item of `type`, fully controlled like `TaskForm`: the parent owns
 * `value`, the attached files' details (`files`, kept in step through `onFilesChange`) and the
 * errors, and does the saving. A file item starts with its file and a link with its URL. "Visible
 * to" shows only when `canChooseVisibility` (admins; a client's own item is always public), and
 * is disabled with a hint when `visibilityLocked` (an admin editing a client's item).
 * `timeErrors` marks reminder time rows by index (such as a time that passed before saving);
 * without it, a `times` error marks the rows `validateTimes` finds.
 * Needs the `knowledge`, `reminders`, `forms` and `chat` locale namespaces.
 */
export function KnowledgeForm({
  value,
  onChange,
  groupId,
  type,
  errors = {},
  timeErrors,
  files,
  onFilesChange,
  canChooseVisibility,
  visibilityLocked = false,
  inAdminsFolder = false,
  authorId,
  autoFocusTitle = false,
}: {
  value: KnowledgeFormValue;
  onChange: (next: KnowledgeFormValue) => void;
  groupId: string;
  type: KnowledgeType;
  errors?: KnowledgeFormErrors;
  timeErrors?: Record<number, string>;
  /** Details of the files in `value.fileIds`; new uploads are added through `onFilesChange`. */
  files: FileInfo[];
  onFilesChange: (next: FileInfo[]) => void;
  canChooseVisibility: boolean;
  visibilityLocked?: boolean;
  /** The item is (or goes) into an admins-only folder: "Only eGrant", locked. */
  inAdminsFolder?: boolean;
  /** The item's author (the current user on create): a fixed reminder recipient. */
  authorId: string;
  autoFocusTitle?: boolean;
}) {
  const { t } = useTranslation();
  const people = useGroupPeople(groupId).data;
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  // Uploads finish after the render that started them; they must add to the latest values.
  const latest = useRef({ value, onChange, files, onFilesChange });
  useEffect(() => {
    latest.current = { value, onChange, files, onFilesChange };
  });

  const set = (patch: Partial<KnowledgeFormValue>) => onChange({ ...value, ...patch });
  const describedBy = (field: keyof KnowledgeFormErrors) =>
    errors[field] ? id(`${field}-error`) : undefined;

  const setVisibility = (visibility: Visibility) => {
    // An admins-only reminder notifies admins only: drop the others it was going to reach.
    set({
      visibility,
      recipientIds: allowedRecipients(value.recipientIds, visibility, people, authorId),
    });
  };

  const onAdd = (file: FileInfo) => {
    // The ref is updated here, not only after render, so two uploads finishing together both land.
    const cur = latest.current;
    const nextFiles = [...cur.files.filter((f) => f.id !== file.id), file];
    const nextValue = { ...cur.value, fileIds: [...cur.value.fileIds, file.id] };
    if (type === 'file' && cur.value.title.trim() === '') nextValue.title = baseName(file.name);
    latest.current = { ...cur, value: nextValue, files: nextFiles };
    cur.onFilesChange(nextFiles);
    cur.onChange(nextValue);
  };
  const onRemove = (fileId: string) => {
    const cur = latest.current;
    const nextFiles = cur.files.filter((f) => f.id !== fileId);
    const nextValue = { ...cur.value, fileIds: cur.value.fileIds.filter((f) => f !== fileId) };
    latest.current = { ...cur, value: nextValue, files: nextFiles };
    cur.onFilesChange(nextFiles);
    cur.onChange(nextValue);
  };

  const isDescription = type === 'file' || type === 'link';

  return (
    <div className="space-y-5">
      {errors.form && (
        <p role="alert" className="text-button text-error-ink">
          {errors.form}
        </p>
      )}

      {type === 'file' && (
        <div className={FIELD}>
          <Label id={id('file-label')}>{t('knowledge.form.file')}</Label>
          <FilesField
            groupId={groupId}
            labelId={id('file-label')}
            max={1}
            inputTestId="knowledge-file-input"
            fileIds={value.fileIds}
            files={files}
            onAdd={onAdd}
            onRemove={onRemove}
          />
          <FieldError id={id('file-error')} message={errors.file} />
        </div>
      )}

      {type === 'link' && (
        <div className={FIELD}>
          <Label htmlFor={id('url')}>{t('knowledge.form.url')}</Label>
          <Input
            id={id('url')}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={value.url}
            maxLength={KNOWLEDGE_LIMITS.url}
            aria-invalid={!!errors.url || undefined}
            aria-describedby={describedBy('url')}
            onChange={(event) => set({ url: event.target.value })}
          />
          <FieldError id={id('url-error')} message={errors.url} />
        </div>
      )}

      <div className={FIELD}>
        <Label htmlFor={id('title')}>{t('knowledge.form.title')}</Label>
        <Input
          id={id('title')}
          autoFocus={autoFocusTitle}
          value={value.title}
          maxLength={KNOWLEDGE_LIMITS.title}
          aria-invalid={!!errors.title || undefined}
          aria-describedby={describedBy('title')}
          onChange={(event) => set({ title: event.target.value })}
        />
        <FieldError id={id('title-error')} message={errors.title} />
      </div>

      <div className={FIELD}>
        <FormattedTextField
          id={id('body')}
          groupId={groupId}
          people={people}
          value={value.body}
          onChange={(body) => set({ body })}
          label={t(isDescription ? 'knowledge.form.description' : 'knowledge.form.body')}
          editLabel={t(
            isDescription ? 'knowledge.form.editDescription' : 'knowledge.form.editBody',
          )}
          error={errors.body}
          errorId={id('body-error')}
        />
        <FieldError id={id('body-error')} message={errors.body} />
      </div>

      {type === 'note' && (
        <div className={FIELD}>
          <Label id={id('files-label')}>{t('knowledge.form.files')}</Label>
          <FilesField
            groupId={groupId}
            labelId={id('files-label')}
            max={KNOWLEDGE_LIMITS.noteFiles}
            inputTestId="knowledge-files-input"
            fileIds={value.fileIds}
            files={files}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        </div>
      )}

      {type === 'reminder' && (
        <>
          <div className={FIELD}>
            <ReminderTimesField
              value={value.times}
              onChange={(times) => set({ times })}
              errors={timeErrors ?? (errors.times ? validateTimes(value.times) : undefined)}
            />
            <FieldError id={id('times-error')} message={errors.times} />
          </div>
          <RecipientsField
            groupId={groupId}
            value={value.recipientIds}
            onChange={(recipientIds) => set({ recipientIds })}
            authorId={authorId}
            adminsOnly={value.visibility === 'admins'}
            error={errors.recipients}
          />
        </>
      )}

      {canChooseVisibility && (
        <VisibilityControl
          value={inAdminsFolder ? 'admins' : value.visibility}
          onChange={setVisibility}
          disabled={visibilityLocked || inAdminsFolder}
          hint={
            inAdminsFolder
              ? t('knowledge.folders.inAdmins')
              : visibilityLocked
                ? t('knowledge.form.visibilityLocked')
                : undefined
          }
        />
      )}
    </div>
  );
}
