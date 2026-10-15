import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  MESSAGE_MAX_FILES,
  MESSAGE_MAX_LENGTH,
  plainExcerpt,
  type MessageDto,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { uploadFile } from '@/features/files/upload';
import { formatFileSize } from '@/features/files/format-size';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  applyFormat,
  mentionQueryAt,
  toEditable,
  toStored,
  type FormatKind,
  type PickedPerson,
} from './composer-text';
import { FormatToolbar, formatShortcut, iconButton } from './format-toolbar';
import { CloseIcon, PaperclipIcon } from './icons';
import { MentionPicker, type MentionChoice, type MentionPickerHandle } from './mention-picker';

export interface ComposerProps {
  mode: 'new' | 'edit' | 'thread';
  groupId: string;
  /** Edit mode: the stored body being edited (mention tokens). */
  initialBody?: string;
  /** Edit mode: the message already has files, so an empty text is still a valid message. */
  hasAttachments?: boolean;
  replyTo?: { message: MessageDto; onCancel(): void };
  /**
   * The element that accepts dropped files, usually the conversation. Pass it to exactly one
   * composer on a page: two composers listening on the same element would upload every drop twice.
   */
  dropTarget?: RefObject<HTMLElement | null>;
  /**
   * Called with the stored body (mention tokens). Edit mode waits for a returned promise and shows
   * an error when it rejects; the other modes clear the composer at once.
   */
  onSubmit(input: { body: string; fileIds: string[]; replyToId?: string }): void | Promise<void>;
  onCancel?(): void;
}

type Upload = {
  key: number;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  file: File;
  fileId?: string;
  error?: string;
};

const COUNTER_FROM = 9_000;
const MAX_LINES = 8;
const REPLY_EXCERPT = 80;
// A transparent 44 px tap area around a 32 px control (6px above and below, 4px at the sides).
const HIT = "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']";

const isTouch = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function Composer({
  mode,
  groupId,
  initialBody = '',
  hasAttachments = false,
  replyTo,
  dropTarget,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const { t, i18n } = useTranslation();
  const people = useGroupPeople(groupId).data;
  const allLabel = t('chat.mention.all');
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;

  const initial = useMemo(
    () => toEditable(initialBody, nameOf, allLabel),
    // Only the first render matters: later edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [value, setValue] = useState(initial.text);
  const [picked, setPicked] = useState<PickedPerson[]>(initial.picked);
  const [caret, setCaret] = useState(initial.text.length);
  // Editing starts with the picker closed: a body ending in "@Name" must not open it.
  const [closedAt, setClosedAt] = useState<number | null>(
    () => mentionQueryAt(initial.text, initial.text.length)?.start ?? null,
  );
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeOption, setActiveOption] = useState<string | undefined>();

  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useRef<MentionPickerHandle>(null);
  const nextKey = useRef(0);
  const pendingSelection = useRef<[number, number] | null>(null);
  const listId = useId();

  const mention = useMemo(() => mentionQueryAt(value, caret), [value, caret]);
  const pickerOpen = mention !== null && mention.start !== closedAt && people !== undefined;

  // Restore the selection after a programmatic edit, then grow the field up to eight lines.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    if (pendingSelection.current) {
      el.setSelectionRange(...pendingSelection.current);
      pendingSelection.current = null;
    }
    el.style.height = 'auto';
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 24;
    const extra = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + extra)}px`;
  }, [value]);

  // The ref is the source of truth so two quick drops count against the limit together.
  const uploadsRef = useRef<Upload[]>([]);
  function commitUploads(next: Upload[]) {
    uploadsRef.current = next;
    setUploads(next);
  }

  function addFiles(incoming: File[]) {
    {
      if (incoming.length === 0) return;
      const room = Math.max(MESSAGE_MAX_FILES - uploadsRef.current.length, 0);
      const accepted = incoming.slice(0, room);
      setNotice(accepted.length < incoming.length ? t('chat.composer.tooManyFiles') : null);
      const added = accepted.map<Upload>((file) => ({
        key: nextKey.current++,
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'uploading',
        file,
      }));
      commitUploads([...uploadsRef.current, ...added]);
      added.forEach(startUpload);
    }
  }

  function startUpload(upload: Upload) {
    const patch = (p: Partial<Upload>) =>
      commitUploads(uploadsRef.current.map((u) => (u.key === upload.key ? { ...u, ...p } : u)));
    uploadFile(groupId, upload.file, (progress) => patch({ progress }))
      .then((info) => patch({ status: 'done', progress: 1, fileId: info.id }))
      .catch((error: unknown) =>
        patch({
          status: 'error',
          error:
            error instanceof ApiError && error.status === 413
              ? t('chat.composer.fileTooLarge')
              : t('errors.generic'),
        }),
      );
  }

  function retryUpload(upload: Upload) {
    const fresh: Upload = { ...upload, status: 'uploading', progress: 0, error: undefined };
    commitUploads(uploadsRef.current.map((u) => (u.key === upload.key ? fresh : u)));
    startUpload(fresh);
  }

  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });

  // Files dropped anywhere on the conversation.
  useEffect(() => {
    const target = dropTarget?.current;
    if (!target || mode === 'edit') return;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      addFilesRef.current([...(e.dataTransfer?.files ?? [])]);
    };
    target.addEventListener('dragover', over);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragover', over);
      target.removeEventListener('drop', drop);
    };
  }, [dropTarget, mode]);

  const uploading = uploads.some((u) => u.status === 'uploading');
  const fileIds = uploads.flatMap((u) => (u.fileId ? [u.fileId] : []));
  const uploadFailed = uploads.some((u) => u.status === 'error');
  // The limit applies to the stored body, where `@Name` has grown into a mention token.
  const storedLength = useMemo(
    () =>
      (picked.length === 0 && !value.includes(allLabel) ? value : toStored(value, picked, allLabel))
        .length,
    [value, picked, allLabel],
  );
  const tooLong = storedLength > MESSAGE_MAX_LENGTH;
  const canSend =
    !busy &&
    !uploading &&
    !uploadFailed &&
    !tooLong &&
    (value.trim().length > 0 || fileIds.length > 0 || hasAttachments);

  async function submit() {
    if (!canSend) return;
    const body = toStored(value, picked, allLabel).trim();
    const input = { body, fileIds, ...(replyTo ? { replyToId: replyTo.message.id } : {}) };
    if (mode !== 'edit') {
      setValue('');
      setPicked([]);
      setCaret(0);
      commitUploads([]);
      setNotice(null);
      replyTo?.onCancel();
      void onSubmit(input);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(input);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  function edit(next: { value: string; start: number; end: number }) {
    pendingSelection.current = [next.start, next.end];
    setValue(next.value);
    setCaret(next.end);
    textarea.current?.focus();
  }

  function format(kind: FormatKind) {
    const el = textarea.current;
    if (!el) return;
    edit(applyFormat(value, el.selectionStart, el.selectionEnd, kind));
  }

  function pick(choice: MentionChoice) {
    if (!mention) return;
    const label = choice.type === 'all' ? allLabel : `@${choice.person.name}`;
    if (choice.type === 'person') {
      const { id, name } = choice.person;
      setPicked((list) => [...list, { id, name }]);
    }
    const next = `${value.slice(0, mention.start)}${label} ${value.slice(caret)}`;
    const at = mention.start + label.length + 1;
    edit({ value: next, start: at, end: at });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // keyCode 229: Safari sends Enter after compositionend with isComposing already false.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (pickerOpen && picker.current?.handleKey(e)) return;
    const kind = formatShortcut(e);
    if (kind) {
      e.preventDefault();
      format(kind);
      return;
    }
    if (e.key === 'Escape' && mode === 'edit') {
      e.preventDefault();
      onCancel?.();
    } else if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      void submit();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (mode === 'edit') return;
    // Text copied from a spreadsheet also carries an image of the cells: the text wins.
    if (e.clipboardData.getData?.('text/plain')) return;
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    addFiles(images);
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    addFiles([...(e.target.files ?? [])]);
    e.target.value = '';
  }

  const placeholder =
    mode === 'thread' ? t('chat.composer.threadPlaceholder') : t('chat.composer.placeholder');

  return (
    <div className="flex flex-col gap-2">
      {replyTo && (
        <div className="flex items-center gap-2 border-l-2 border-border pl-2 text-micro text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {t('chat.composer.replyingTo', {
              name: replyTo.message.author.name,
              excerpt: plainExcerpt(replyTo.message.body, nameOf, REPLY_EXCERPT, allLabel),
            })}
          </span>
          <button
            type="button"
            aria-label={t('chat.composer.cancelReply')}
            title={t('chat.composer.cancelReply')}
            onClick={replyTo.onCancel}
            className={iconButton}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <div className="relative">
        {pickerOpen && mention && people && (
          <MentionPicker
            ref={picker}
            // A new query starts at the top of the list again.
            key={mention.query}
            id={`${listId}-mentions`}
            query={mention.query}
            people={people}
            onPick={pick}
            onClose={() => setClosedAt(mention.start)}
            onActiveChange={setActiveOption}
            below={mode === 'edit'}
          />
        )}
        <div className="rounded-lg border-2 border-input bg-card focus-within:border-foreground">
          <textarea
            ref={textarea}
            autoFocus={mode === 'edit'}
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label={mode === 'edit' ? t('chat.actions.edit') : placeholder}
            aria-controls={pickerOpen ? `${listId}-mentions` : undefined}
            aria-activedescendant={pickerOpen ? activeOption : undefined}
            aria-autocomplete="list"
            onChange={(e) => {
              setValue(e.target.value);
              setCaret(e.target.selectionStart);
              setClosedAt(null);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="block w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-body outline-none placeholder:text-muted-foreground"
          />
          <FormatToolbar onFormat={format} className="border-b-0 border-t">
            {storedLength > COUNTER_FROM && (
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap text-micro',
                  tooLong ? 'text-error-ink' : 'text-muted-foreground',
                )}
              >
                {t('chat.composer.tooLong', { count: storedLength.toLocaleString(i18n.language) })}
              </span>
            )}
            {mode !== 'edit' && (
              <>
                <input ref={fileInput} type="file" multiple hidden onChange={onPickFiles} />
                <button
                  type="button"
                  aria-label={t('chat.composer.attach')}
                  title={t('chat.composer.attach')}
                  onClick={() => fileInput.current?.click()}
                  className={cn(iconButton, 'relative shrink-0', HIT)}
                >
                  <PaperclipIcon />
                </button>
              </>
            )}
            {mode === 'edit' && (
              <Button size="sm" variant="ghost" onClick={onCancel} className={cn('relative', HIT)}>
                {t('chat.cancel')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!canSend}
              onClick={() => void submit()}
              className={cn('relative', HIT)}
            >
              {mode === 'edit' ? t('chat.composer.save') : t('chat.composer.send')}
            </Button>
          </FormatToolbar>
        </div>
      </div>
      {uploads.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                'relative flex max-w-full items-center gap-2 overflow-hidden rounded-lg bg-secondary py-1 pl-3 pr-1 text-button text-secondary-foreground',
                u.status === 'error' && 'text-error-ink',
              )}
            >
              <span title={u.name} className="min-w-0 truncate font-semibold">
                {u.name}
              </span>
              <span className="shrink-0 text-micro text-muted-foreground">
                {u.status === 'error' ? u.error : formatFileSize(u.size, i18n.language)}
              </span>
              {u.status === 'error' && (
                <button
                  type="button"
                  onClick={() => retryUpload(u)}
                  className="shrink-0 rounded-md px-2 py-1 text-micro font-semibold underline"
                >
                  {t('errors.retry')}
                </button>
              )}
              <button
                type="button"
                aria-label={t('chat.composer.removeFile')}
                title={t('chat.composer.removeFile')}
                onClick={() => commitUploads(uploadsRef.current.filter((x) => x.key !== u.key))}
                className={iconButton}
              >
                <CloseIcon />
              </button>
              {u.status === 'uploading' && (
                <div
                  role="progressbar"
                  aria-label={u.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(u.progress * 100)}
                  className="absolute inset-x-0 bottom-0 h-0.5"
                >
                  <div
                    className="h-full bg-brand-purple"
                    style={{ width: `${u.progress * 100}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(notice || failed) && (
        <p role="alert" className="text-micro text-error-ink">
          {failed ? t('errors.generic') : notice}
        </p>
      )}
    </div>
  );
}
