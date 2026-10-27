import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  fillSnippet,
  isPickable,
  MESSAGE_MAX_FILES,
  MESSAGE_MAX_LENGTH,
  plainExcerpt,
  splitMentionTokens,
  type MessageDto,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { formatFileSize } from '@/features/files/format-size';
import { chatPeopleQuery, useChatPeople, useChatScope, useChatUpload } from './chat-scope';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { withNamespaces } from '@/i18n/namespaces';
import { toStored, type FormatKind, type PickedPerson } from './composer-text';
import { safeHref } from './format/parse';
import { FormatToolbar, iconButton, phoneIconButton } from './format-toolbar';
import {
  BookIcon,
  ClipIcon,
  CloseIcon,
  PlusIcon,
  SendIcon,
  SmileIcon,
  TaskIcon,
  TicketIcon,
} from './icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PickedKnowledge } from './knowledge-picker';
import { PickedChips } from './attach-picker/chips';
import type { PickedTask, PickedTicket } from './attach-picker/picked';
import { MentionPicker, type MentionChoice, type MentionPickerHandle } from './mention-picker';
import type { Tab as AttachTab } from './attach-picker';
import { AiTextButton } from './ai-tools/ai-text-button';
import { VoiceButton } from './voice-input/voice-button';
import type { ChatEditorHandle, EditorChange } from './editor/chat-editor';
import { draftKey, readDraft, removeDraft, saveDraft } from './drafts';
import type { MentionQuery } from './editor/setup';

// ProseMirror is its own chunk, requested as soon as the chat's chunk runs (in parallel with the
// messages), so the first screen never carries it and the field is usually ready on arrival.
const editorChunk = import('./editor/chat-editor');
const ChatEditor = lazy(() => editorChunk);

/**
 * The draft, for tools that read and replace it (the AI text tools, voice input). Markdown is
 * the stored form, with mention tokens `<@id>`: the same body `onSubmit` receives.
 */
export interface ComposerHandle {
  getMarkdown(): string;
  /** Replaces the draft for review; one undo step (Cmd/Ctrl+Z brings the old text back). */
  setMarkdown(markdown: string): void;
  focus(): void;
}

// Phase 28 and 34: the attachment picker (knowledge, tasks, tickets) loads when first opened.
// The reactions' emoji set, the same lazy chunk.
const EmojiPickerSheet = lazy(() => import('./emoji-picker-sheet'));
const AttachPicker = lazy(withNamespaces(['forms', 'knowledge'], () => import('./attach-picker')));
// F7: an admin's canned replies under a `/`; loads (with its texts) on the first `/`.
const SnippetPicker = lazy(
  withNamespaces(['snippets'], () => import('@/features/snippets/snippet-picker')),
);

export interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  mode: 'new' | 'edit' | 'thread';
  groupId: string;
  /** The channel written to: shows the AI text tools and voice input it offers (Phase 28). */
  channelId?: string;
  /** Thread mode: the thread's root message, so its unsent text is kept apart from the chat's. */
  threadId?: string;
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
  onSubmit(input: {
    body: string;
    fileIds: string[];
    knowledgeIds?: string[];
    taskIds?: string[];
    ticketIds?: string[];
    replyToId?: string;
  }): void | Promise<void>;
  onCancel?(): void;
  /**
   * Extra buttons in the box's bottom row, just before Send: the slot for draft tools (AI text
   * tools, voice input), which read and replace the draft through the `ref` handle.
   */
  extraActions?: ReactNode;
  /** Focus the field once it is there (edit mode always does; N6a's `?reply=1` asks for it). */
  autoFocus?: boolean;
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
const REPLY_EXCERPT = 80;
// A transparent 44 px tap area around a 32 px control (6px above and below, 4px at the sides).
const HIT = "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']";

const isTouch = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function Composer({
  ref,
  mode,
  groupId,
  channelId,
  threadId,
  initialBody = '',
  hasAttachments = false,
  replyTo,
  dropTarget,
  onSubmit,
  onCancel,
  extraActions,
  autoFocus = false,
}: ComposerProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const scope = useChatScope();
  const admin = isAdmin(useSession());
  const people = useChatPeople(groupId).data;
  const sendFile = useChatUpload(groupId);
  // Only clients and managers can be mentioned; names still resolve against every reader.
  const pickable = useMemo(() => people?.filter(isPickable), [people]);
  const allLabel = t('chat.mention.all');
  const unknownLabel = t('chat.mention.unknown');
  const labels = useMemo(
    () => ({ all: allLabel, unknown: unknownLabel }),
    [allLabel, unknownLabel],
  );
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;

  // The unsent text of this chat (or thread) survives an unmount until the page reloads; never in
  // the edit box. Read once: the editor takes its first content only when it is created.
  const draftId = mode !== 'edit' && channelId ? draftKey(channelId, threadId) : null;
  const [firstBody] = useState(() =>
    initialBody === '' && draftId !== null ? readDraft(draftId) : initialBody,
  );
  const [markdown, setMarkdown] = useState(firstBody);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  // F7: the `/query` at the caret, and the `/` whose list Escape closed.
  const [slash, setSlash] = useState<MentionQuery | null>(null);
  const [slashClosedAt, setSlashClosedAt] = useState<number | null>(null);
  const [active, setActive] = useState<ReadonlySet<FormatKind>>(() => new Set());
  // Escape closes the list for that `@`; typing anything reopens it.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'generic' | 'mention' | null>(null);
  const [activeOption, setActiveOption] = useState<string | undefined>();
  // Phase 28: knowledge items to attach, and whether their picker is open.
  const [knowledge, setKnowledge] = useState<PickedKnowledge[]>([]);
  const [pickerTab, setPickerTab] = useState<AttachTab | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Phase 34: tasks and tickets to attach, picked in the same dialog.
  const [tasks, setTasks] = useState<PickedTask[]>([]);
  const [tickets, setTickets] = useState<PickedTicket[]>([]);
  // A reader who reaches knowledge only through messages (a žiadateľ) attaches none.
  const canAttachKnowledge = mode !== 'edit' && !scope.knowledgeViaMessage;

  const editor = useRef<ChatEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useRef<MentionPickerHandle>(null);
  const snippetPicker = useRef<MentionPickerHandle>(null);
  const nextKey = useRef(0);
  const listId = useId();

  const pickerOpen = mention !== null && mention.from !== closedAt && people !== undefined;
  const snippetsOpen = admin && slash !== null && slash.from !== slashClosedAt;

  // The AI and voice tools read the draft when their answer arrives, not when they were clicked;
  // the editor holds the current one. A replacement is one undo step (Cmd/Ctrl+Z restores).
  const draftTools = {
    getText: () => editor.current?.getMarkdown() ?? markdown,
    setText: (text: string) => editor.current?.setMarkdown(text),
  };

  useImperativeHandle(ref, () => ({
    getMarkdown: () => editor.current?.getMarkdown() ?? markdown,
    setMarkdown: (md) => editor.current?.setMarkdown(md),
    focus: () => editor.current?.focus(),
  }));

  function onEditorChange(change: EditorChange) {
    if (change.docChanged && draftId !== null) saveDraft(draftId, change.markdown);
    setMarkdown(change.markdown);
    setMention(change.mention);
    setSlash(change.slash);
    setActive(change.active);
    if (change.docChanged) {
      setClosedAt(null);
      setSlashClosedAt(null);
    }
  }

  // The ref is the source of truth so two quick drops count against the limit together.
  const uploadsRef = useRef<Upload[]>([]);
  function commitUploads(next: Upload[]) {
    uploadsRef.current = next;
    setUploads(next);
  }

  function addFiles(incoming: File[]) {
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

  function startUpload(upload: Upload) {
    const patch = (p: Partial<Upload>) =>
      commitUploads(uploadsRef.current.map((u) => (u.key === upload.key ? { ...u, ...p } : u)));
    sendFile(upload.file, (progress) => patch({ progress }))
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

  const uploading = uploads.some((u) => u.status === 'uploading');
  const fileIds = uploads.flatMap((u) => (u.fileId ? [u.fileId] : []));
  const uploadFailed = uploads.some((u) => u.status === 'error');
  /**
   * The body as sent: a typed `@all` (the label) and a typed `@Name` of someone already picked in
   * the draft become mention tokens too, as in the plain composer (text pasted or filled in
   * without the picker).
   */
  const stored = (draft: string) => {
    const picked: PickedPerson[] = [];
    for (const part of splitMentionTokens(draft)) {
      if (part.type !== 'mention' || part.id === 'all') continue;
      const { id } = part;
      const name = nameOf(id);
      if (name !== undefined && !picked.some((p) => p.id === id)) picked.push({ id, name });
    }
    return toStored(draft, picked, allLabel);
  };
  const storedBody = useMemo(
    () => (markdown.includes('@') ? stored(markdown) : markdown),
    // `stored` reads the people and the label, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown, people, allLabel],
  );
  // The limit applies to the stored body, where a pill is a longer mention token.
  const storedLength = storedBody.length;
  const tooLong = storedLength > MESSAGE_MAX_LENGTH;
  const canSendBody = (body: string) =>
    !busy &&
    !uploading &&
    !uploadFailed &&
    body.length <= MESSAGE_MAX_LENGTH &&
    (body.trim().length > 0 ||
      fileIds.length > 0 ||
      knowledge.length > 0 ||
      tasks.length > 0 ||
      tickets.length > 0 ||
      hasAttachments);
  const canSend = canSendBody(storedBody);

  async function submit() {
    // Enter can come before the last keystroke has rendered: the editor has the current draft.
    const draft = stored(editor.current?.getMarkdown() ?? markdown);
    if (!canSendBody(draft)) return;
    const body = draft.trim();
    const input = {
      body,
      fileIds,
      ...(knowledge.length > 0 ? { knowledgeIds: knowledge.map((k) => k.id) } : {}),
      ...(tasks.length > 0 ? { taskIds: tasks.map((k) => k.id) } : {}),
      ...(tickets.length > 0 ? { ticketIds: tickets.map((k) => k.id) } : {}),
      ...(replyTo ? { replyToId: replyTo.message.id } : {}),
    };
    if (mode !== 'edit') {
      editor.current?.clear();
      if (draftId !== null) removeDraft(draftId);
      setMarkdown('');
      setKnowledge([]);
      setTasks([]);
      setTickets([]);
      commitUploads([]);
      setNotice(null);
      replyTo?.onCancel();
      void onSubmit(input);
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await onSubmit(input);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_mention') {
        // Someone stopped being mentionable: keep the text and refresh the picker's list.
        setFailed('mention');
        void queryClient.invalidateQueries({ queryKey: chatPeopleQuery(scope, groupId).queryKey });
      } else {
        setFailed('generic');
      }
    }
    setBusy(false);
  }

  function format(kind: FormatKind) {
    if (kind === 'link' && !active.has('link')) {
      setLinkInvalid(false);
      setLinkOpen(true);
      return;
    }
    editor.current?.format(kind);
  }

  function addLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get('url') ?? '').trim();
    // "egrant.sk/vyzvy" is meant as a web address.
    const href = raw && safeHref(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!href) {
      setLinkInvalid(true);
      return;
    }
    setLinkOpen(false);
    editor.current?.setLink(href);
  }

  function closeLink() {
    setLinkOpen(false);
    editor.current?.focus();
  }

  function pick(choice: MentionChoice) {
    if (!mention) return;
    if (choice.type === 'all') editor.current?.insertMention(mention, 'all', allLabel);
    else editor.current?.insertMention(mention, choice.person.id, `@${choice.person.name}`);
  }

  /**
   * F7: a canned reply replaces its `/query`; `{{name}}` is the person answered (the quoted
   * message's author, else the conversation's own, such as a ticket's initiator).
   */
  function pickSnippet(body: string) {
    if (!slash) return;
    const name = replyTo?.message.author.name ?? scope.replyName ?? null;
    editor.current?.insertMarkdown(slash, fillSnippet(body, name));
  }

  /**
   * Keys the composer takes before the editor: the mention list, the canned replies, and Escape
   * in the edit box.
   */
  function onKeyDown(e: KeyboardEvent): boolean {
    if (pickerOpen && picker.current?.handleKey(e)) return true;
    if (snippetsOpen && snippetPicker.current?.handleKey(e)) return true;
    if (e.key === 'Escape' && mode === 'edit') {
      e.preventDefault();
      onCancel?.();
      return true;
    }
    return false;
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    addFiles([...(e.target.files ?? [])]);
    e.target.value = '';
  }

  // The editor and the drop listener call these between renders: always the latest version.
  const handlers = useRef({ addFiles, submit, onKeyDown });
  useEffect(() => {
    handlers.current = { addFiles, submit, onKeyDown };
  });

  /** Enter without Shift: sends on a computer; on a touch screen it is a new line. */
  function onEnter(): boolean {
    if (isTouch()) return false;
    void handlers.current.submit();
    return true;
  }

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
      handlers.current.addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    target.addEventListener('dragover', over);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragover', over);
      target.removeEventListener('drop', drop);
    };
  }, [dropTarget, mode]);

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
            className={phoneIconButton}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <div className="relative">
        {pickerOpen && mention && pickable && (
          <MentionPicker
            ref={picker}
            // A new query starts at the top of the list again.
            key={mention.query}
            id={`${listId}-mentions`}
            query={mention.query}
            people={pickable}
            onPick={pick}
            onClose={() => setClosedAt(mention.from)}
            onActiveChange={setActiveOption}
            below={mode === 'edit'}
          />
        )}
        {snippetsOpen && slash && !pickerOpen && (
          <Suspense fallback={null}>
            <SnippetPicker
              ref={snippetPicker}
              key={slash.from}
              id={`${listId}-snippets`}
              query={slash.query}
              onPick={(snippet) => pickSnippet(snippet.body)}
              onClose={() => setSlashClosedAt(slash.from)}
              onActiveChange={setActiveOption}
              below={mode === 'edit'}
            />
          </Suspense>
        )}
        <div className="rounded-lg border-2 border-input bg-card focus-within:border-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                className="min-h-10 px-3 py-2 text-body text-muted-foreground"
              >
                {placeholder}
              </div>
            }
          >
            <ChatEditor
              ref={editor}
              initialMarkdown={firstBody}
              nameOf={nameOf}
              labels={labels}
              placeholder={placeholder}
              ariaLabel={mode === 'edit' ? t('chat.actions.edit') : placeholder}
              ariaControls={
                pickerOpen ? `${listId}-mentions` : snippetsOpen ? `${listId}-snippets` : undefined
              }
              ariaActiveDescendant={pickerOpen || snippetsOpen ? activeOption : undefined}
              autoFocus={mode === 'edit' || autoFocus}
              onEnter={onEnter}
              onKeyDown={(e) => handlers.current.onKeyDown(e)}
              onPasteFiles={
                mode === 'edit' ? undefined : (files) => handlers.current.addFiles(files)
              }
              onChange={onEditorChange}
            />
          </Suspense>
          {linkOpen && (
            <form
              noValidate
              onSubmit={addLink}
              className="flex items-center gap-1 border-t border-border px-1.5 py-1"
            >
              <input
                name="url"
                type="url"
                inputMode="url"
                autoFocus
                placeholder="https://"
                aria-label={t('chat.composer.linkUrl')}
                aria-invalid={linkInvalid || undefined}
                onChange={() => setLinkInvalid(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeLink();
                  }
                }}
                className={cn(
                  'min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-button outline-none placeholder:text-muted-foreground max-[640px]:min-h-11',
                  linkInvalid && 'text-error-ink',
                )}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={closeLink}
                className={cn('relative', HIT)}
              >
                {t('chat.cancel')}
              </Button>
              <Button size="sm" type="submit" className={cn('relative', HIT)}>
                {t('chat.composer.addLink')}
              </Button>
            </form>
          )}
          <FormatToolbar onFormat={format} active={active} className="border-b-0 border-t">
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
                {canAttachKnowledge ? (
                  // One plus button: the picker on a chosen tab, or the device's file chooser.
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('chat.composer.add')}
                        title={t('chat.composer.add')}
                        className={cn(iconButton, 'relative shrink-0', HIT)}
                      >
                        <PlusIcon />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      // The picker or the editor takes the focus, not the button.
                      onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                      <DropdownMenuItem onSelect={() => setPickerTab('knowledge')}>
                        <BookIcon />
                        {t('chat.work.tabs.knowledge')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPickerTab('tasks')}>
                        <TaskIcon />
                        {t('chat.work.tabs.tasks')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPickerTab('tickets')}>
                        <TicketIcon />
                        {t('chat.composer.addTicket')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                        <ClipIcon />
                        {t('chat.composer.addUpload')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  // Nothing else to offer (a reader who gets knowledge through messages): the
                  // button goes straight to the file chooser.
                  <button
                    type="button"
                    aria-label={t('chat.composer.attach')}
                    title={t('chat.composer.attach')}
                    onClick={() => fileInput.current?.click()}
                    className={cn(iconButton, 'relative shrink-0', HIT)}
                  >
                    <PlusIcon />
                  </button>
                )}
                {channelId && (
                  <>
                    <VoiceButton target={{ kind: 'channel', id: channelId }} {...draftTools} />
                    <AiTextButton target={{ kind: 'channel', id: channelId }} {...draftTools} />
                  </>
                )}
              </>
            )}
            <button
              type="button"
              aria-label={t('chat.composer.emoji')}
              title={t('chat.composer.emoji')}
              onClick={() => setEmojiOpen(true)}
              className={cn(iconButton, 'relative shrink-0', HIT)}
            >
              <SmileIcon />
            </button>
            {extraActions}
            {mode === 'edit' && (
              <Button size="sm" variant="ghost" onClick={onCancel} className={cn('relative', HIT)}>
                {t('chat.cancel')}
              </Button>
            )}
            {mode === 'edit' ? (
              <Button
                size="sm"
                disabled={!canSend}
                onClick={() => void submit()}
                className={cn('relative', HIT)}
              >
                {t('chat.composer.save')}
              </Button>
            ) : (
              // On phones Send is a 44 px filled circle with a paper plane, so the row keeps room
              // for the marks next to the paperclip, knowledge, voice and AI buttons.
              <Button
                size="sm"
                disabled={!canSend}
                onClick={() => void submit()}
                aria-label={t('chat.composer.send')}
                className={cn('relative', HIT, 'touch:size-11 max-[640px]:px-0')}
              >
                <span className="max-[640px]:hidden">{t('chat.composer.send')}</span>
                <SendIcon className="hidden size-5 max-[640px]:block" />
              </Button>
            )}
          </FormatToolbar>
        </div>
      </div>
      {knowledge.length > 0 && (
        <ul role="list" className="flex flex-wrap gap-2" aria-label={t('chat.knowledge.attached')}>
          {knowledge.map((k) => (
            <li
              key={k.id}
              className="flex max-w-full items-center gap-2 rounded-lg bg-secondary py-1 pl-3 pr-1 text-button text-secondary-foreground"
            >
              <span className="shrink-0 text-brand-purple-ink">
                <BookIcon />
              </span>
              <span title={k.title} className="min-w-0 truncate font-semibold">
                {k.title}
              </span>
              <button
                type="button"
                aria-label={t('chat.knowledge.remove', { title: k.title })}
                title={t('chat.knowledge.remove', { title: k.title })}
                onClick={() => setKnowledge((list) => list.filter((x) => x.id !== k.id))}
                className={phoneIconButton}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PickedChips
        picked={{ knowledge: [], tasks, tickets }}
        kinds={['tasks', 'tickets']}
        onRemove={(kind, id) =>
          kind === 'tasks'
            ? setTasks((list) => list.filter((x) => x.id !== id))
            : setTickets((list) => list.filter((x) => x.id !== id))
        }
      />
      {emojiOpen && (
        <Suspense fallback={null}>
          <EmojiPickerSheet
            purpose="insert"
            onPick={(emoji) => {
              setEmojiOpen(false);
              editor.current?.insertText(emoji);
            }}
            onClose={() => {
              setEmojiOpen(false);
              editor.current?.focus();
            }}
          />
        </Suspense>
      )}
      {pickerTab && (
        <Suspense fallback={null}>
          <AttachPicker
            groupId={groupId}
            initialTab={pickerTab}
            picked={{ knowledge, tasks, tickets }}
            onDone={(picked) => {
              setKnowledge(picked.knowledge);
              setTasks(picked.tasks);
              setTickets(picked.tickets);
              setPickerTab(null);
              editor.current?.focus();
            }}
            onClose={() => setPickerTab(null)}
          />
        </Suspense>
      )}
      {uploads.length > 0 && (
        <ul role="list" className="flex flex-wrap gap-2">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                'relative flex max-w-full animate-fade-in items-center gap-2 overflow-hidden rounded-lg bg-secondary py-1 pl-3 pr-1 text-button text-secondary-foreground',
                u.status === 'error' && 'text-error-ink',
              )}
            >
              <span title={u.name} className="min-w-0 truncate font-semibold">
                {u.name}
              </span>
              <span className="shrink-0 text-micro text-neutral">
                {u.status === 'error' ? u.error : formatFileSize(u.size, i18n.language)}
              </span>
              {u.status === 'error' && (
                <button
                  type="button"
                  onClick={() => retryUpload(u)}
                  className="shrink-0 rounded-md px-2 py-1 text-micro font-semibold underline max-[640px]:min-h-11"
                >
                  {t('errors.retry')}
                </button>
              )}
              <button
                type="button"
                aria-label={t('chat.composer.removeFile')}
                title={t('chat.composer.removeFile')}
                onClick={() => commitUploads(uploadsRef.current.filter((x) => x.key !== u.key))}
                className={phoneIconButton}
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
          {failed === 'mention'
            ? t('chat.composer.mentionNotAllowed')
            : failed
              ? t('errors.generic')
              : notice}
        </p>
      )}
    </div>
  );
}
