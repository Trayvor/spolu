import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KNOWLEDGE_LINKS_MAX, type LinkedKnowledge } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { AiTextButton } from '@/features/chat/ai-tools/ai-text-button';
import type { AiTarget } from '@/features/chat/ai-tools/api';
import type { FormatKind } from '@/features/chat/composer-text';
import ChatEditor, {
  type ChatEditorHandle,
  type EditorChange,
} from '@/features/chat/editor/chat-editor';
import { safeHref } from '@/features/chat/format/parse';
import { FormatToolbar, iconButton, phoneIconButton } from '@/features/chat/format-toolbar';
import { BookIcon, CloseIcon } from '@/features/chat/icons';
import type { PickedKnowledge } from '@/features/chat/knowledge-picker';
import { VoiceButton } from '@/features/chat/voice-input/voice-button';
import { withNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';
import type { DescriptionFieldProps } from './description-field';

const KnowledgePicker = lazy(
  withNamespaces(['forms'], () => import('@/features/chat/knowledge-picker')),
);

type Props = DescriptionFieldProps & {
  nameOf(id: string): string | undefined;
  autoFocus: boolean;
};

/**
 * The editor of `DescriptionField` (a lazy chunk): the chat editor in document mode, the chat's
 * eight-button toolbar with the AI button, the microphone and "Attach from the knowledge base"
 * at its end, and the attached items under it, each removable. The AI and voice calls go to the
 * group's routes; an AI change is one editor undo step, as in chat.
 */
export default function DescriptionEditor({
  id,
  groupId,
  value,
  onChange,
  label,
  error,
  knowledge,
  aiTools = true,
  nameOf,
  autoFocus,
}: Props) {
  const { t } = useTranslation();
  const editor = useRef<ChatEditorHandle>(null);
  const [active, setActive] = useState<ReadonlySet<FormatKind>>(() => new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const target = useMemo<AiTarget>(() => ({ kind: 'group', id: groupId }), [groupId]);
  const allLabel = t('chat.mention.all');
  const unknownLabel = t('chat.mention.unknown');
  const labels = useMemo(
    () => ({ all: allLabel, unknown: unknownLabel }),
    [allLabel, unknownLabel],
  );

  // The AI and voice tools read the text when their answer arrives; the editor holds it.
  const draftTools = {
    getText: () => editor.current?.getMarkdown() ?? value,
    setText: (text: string) => editor.current?.setMarkdown(text),
  };

  function onEditorChange(change: EditorChange) {
    setActive(change.active);
    if (change.docChanged) onChange(change.markdown);
  }

  function format(kind: FormatKind) {
    if (kind === 'link' && !active.has('link')) {
      setLinkInvalid(false);
      setLinkOpen(true);
      return;
    }
    editor.current?.format(kind);
  }

  // A row of its own, not a <form>: the field usually sits inside the dialog's form.
  function addLink() {
    const raw = (linkInput.current?.value ?? '').trim();
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
  function onLinkKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLink();
    }
  }

  const items = knowledge?.items ?? [];
  const picked = items.filter((k): k is PickedKnowledge => k.available);
  const remove = (itemId: string) => knowledge?.onChange(items.filter((k) => k.id !== itemId));
  // The picker returns the available ones; unavailable ones stay until removed by hand.
  const pick = (chosen: PickedKnowledge[]): LinkedKnowledge => [
    ...chosen,
    ...items.filter((k) => !k.available),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'rounded-md border-2 border-input bg-card focus-within:border-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          error && 'border-destructive',
        )}
        data-testid={`${id}-editor`}
      >
        <FormatToolbar onFormat={format} active={active}>
          {aiTools && (
            <>
              <VoiceButton target={target} {...draftTools} />
              <AiTextButton target={target} {...draftTools} />
            </>
          )}
          {knowledge && (
            <button
              type="button"
              aria-label={t('chat.knowledge.attach')}
              title={t('chat.knowledge.attach')}
              onClick={() => setPickerOpen(true)}
              className={cn(iconButton, 'shrink-0')}
            >
              <BookIcon />
            </button>
          )}
        </FormatToolbar>
        {linkOpen && (
          <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
            <input
              ref={linkInput}
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://"
              aria-label={t('chat.composer.linkUrl')}
              aria-invalid={linkInvalid || undefined}
              onChange={() => setLinkInvalid(false)}
              onKeyDown={onLinkKey}
              className={cn(
                'min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-button outline-none placeholder:text-muted-foreground max-[640px]:min-h-11',
                linkInvalid && 'text-error-ink',
              )}
            />
            <Button type="button" size="sm" variant="ghost" onClick={closeLink}>
              {t('chat.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={addLink}>
              {t('chat.composer.addLink')}
            </Button>
          </div>
        )}
        <ChatEditor
          ref={editor}
          document
          initialMarkdown={value}
          nameOf={nameOf}
          labels={labels}
          placeholder=""
          ariaLabel={label}
          autoFocus={autoFocus}
          onEnter={() => false}
          onChange={onEditorChange}
        />
      </div>
      {items.length > 0 && (
        <ul role="list" className="flex flex-wrap gap-2" aria-label={t('chat.knowledge.attached')}>
          {items.map((k) => {
            const title = k.available ? k.title : t('chat.knowledge.unavailable');
            return (
              <li
                key={k.id}
                className={cn(
                  'flex max-w-full items-center gap-2 rounded-lg py-1 pl-3 pr-1 text-button',
                  k.available
                    ? 'bg-secondary text-secondary-foreground'
                    : 'border-2 border-dashed border-border text-muted-foreground',
                )}
              >
                <span className="shrink-0 text-brand-purple-ink">
                  <BookIcon />
                </span>
                <span title={title} className="min-w-0 truncate font-semibold">
                  {title}
                </span>
                <button
                  type="button"
                  aria-label={t('chat.knowledge.remove', { title })}
                  title={t('chat.knowledge.remove', { title })}
                  onClick={() => remove(k.id)}
                  className={phoneIconButton}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pickerOpen && knowledge && (
        <Suspense fallback={null}>
          <KnowledgePicker
            groupId={groupId}
            picked={picked}
            // Unavailable links stay and count toward the limit.
            max={KNOWLEDGE_LINKS_MAX - (items.length - picked.length)}
            limitKey="chat.knowledge.limitDescription"
            onDone={(chosen) => {
              knowledge.onChange(pick(chosen));
              setPickerOpen(false);
              editor.current?.focus();
            }}
            onClose={() => setPickerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
