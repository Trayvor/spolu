import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto, MessageKnowledge } from '@spolu/shared';
import {
  BellIcon,
  ChatFileIcon,
  FileIcon,
  LinkIcon,
  MeetingIcon,
  NoteIcon,
  SmallFolderIcon,
} from '@/features/knowledge/icons';
import { withNamespaces } from '@/i18n/namespaces';
import { Toast } from '@/components/ui/toast';
import { useChatScope } from './chat-scope';

// Both dialogs load on the first click, with the knowledge texts they render.
const KnowledgeDialog = lazy(
  withNamespaces(['knowledge', 'reminders', 'forms'], () =>
    import('@/features/knowledge/knowledge-dialog').then((m) => ({ default: m.KnowledgeDialog })),
  ),
);
const SharedKnowledgeDialog = lazy(
  withNamespaces(['knowledge', 'reminders', 'forms'], () => import('./shared-knowledge-dialog')),
);

/** The knowledge type's icon, shared with the picker. */
export const KNOWLEDGE_ICONS: Record<string, () => React.JSX.Element> = {
  note: NoteIcon,
  file: FileIcon,
  link: LinkIcon,
  reminder: BellIcon,
  meeting: MeetingIcon,
  chat_file: ChatFileIcon,
};

const cardClass =
  'flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border-2 px-3 py-2 text-left max-[640px]:min-h-11';

function Card({ item, onOpen }: { item: MessageKnowledge; onOpen: () => void }) {
  const { t } = useTranslation();
  if (!item.available) {
    return (
      <p className={`${cardClass} border-dashed border-border text-micro text-muted-foreground`}>
        {t('chat.knowledge.unavailable')}
      </p>
    );
  }
  const Glyph = KNOWLEDGE_ICONS[item.type] ?? NoteIcon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${cardClass} border-border bg-card hover:border-foreground focus-visible:border-foreground`}
    >
      <span className="text-brand-purple">
        <Glyph />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="sr-only">{t(`chat.knowledge.types.${item.type}`)}: </span>
        <span className="truncate text-button font-semibold">{item.title}</span>
        {item.folderPath.length > 0 && (
          <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
            <SmallFolderIcon />
            <span className="truncate">{item.folderPath.join(' / ')}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The knowledge items attached to a message (Phase 28): a card each (type icon, title, folder),
 * or "Item unavailable" for one nobody here may read any more. A reader of the group opens it in
 * the knowledge dialog; a reader who reaches it only through the message (`knowledgeViaMessage`,
 * a žiadateľ in a ticket chat) opens the read-only view.
 */
export function KnowledgeCards({ message, groupId }: { message: MessageDto; groupId: string }) {
  const { t } = useTranslation();
  const { knowledgeViaMessage } = useChatScope();
  const [open, setOpen] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  if (message.knowledge.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      {message.knowledge.map((item) => (
        <Card key={item.id} item={item} onOpen={() => setOpen(item.id)} />
      ))}
      {open !== null && (
        <Suspense fallback={null}>
          {knowledgeViaMessage ? (
            <SharedKnowledgeDialog
              messageId={message.id}
              itemId={open}
              groupId={groupId}
              onClose={() => setOpen(null)}
            />
          ) : (
            <KnowledgeDialog
              target={{ mode: 'view', id: open }}
              onClose={() => setOpen(null)}
              onUnavailable={() => {
                setOpen(null);
                setGone(true);
              }}
            />
          )}
        </Suspense>
      )}
      {gone && <Toast onClose={() => setGone(false)}>{t('chat.knowledge.unavailable')}</Toast>}
    </div>
  );
}
