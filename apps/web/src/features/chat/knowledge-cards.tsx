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
import { AdminGroupBadge } from '@/features/knowledge/admin-group-badge';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { withNamespaces } from '@/i18n/namespaces';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { KnowledgeVia } from './api';
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
  'flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border-2 px-3 py-2 text-left touch:min-h-11';

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
      <span className="text-brand-purple-ink">
        <Glyph />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="sr-only">{t(`chat.knowledge.types.${item.type}`)}: </span>
        <span className="truncate text-button font-semibold">{item.title}</span>
        {item.source === 'admin_group' && (
          <AdminGroupBadge label={t('chat.knowledge.adminGroup')} className="mt-0.5 self-start" />
        )}
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
 * a žiadateľ in a ticket chat) opens the read-only view, as does a client opening an item of
 * the admin group (Phase 34).
 */
export function KnowledgeCards({ message, groupId }: { message: MessageDto; groupId: string }) {
  const { knowledgeViaMessage } = useChatScope();
  const through: KnowledgeVia = { kind: 'message', id: message.id };
  return (
    <KnowledgeCardList
      items={message.knowledge}
      groupId={groupId}
      via={knowledgeViaMessage ? through : null}
      subject={through}
      className="mt-1.5"
    />
  );
}

/**
 * The cards of attached items (a message's, or a description's in Phase 33 part P5). `via`: the
 * reader reaches the items only through it (a žiadateľ), so they open read-only; null opens the
 * knowledge dialog. `subject`: the message or description the cards belong to; a non-admin opens
 * an admin-group item (`source: 'admin_group'`, Phase 34) read-only through it, since they do
 * not read the admin group (without a subject, an unsaved form, it is "Item unavailable").
 */
export function KnowledgeCardList({
  items,
  groupId,
  via,
  subject = null,
  className,
}: {
  items: MessageKnowledge[];
  groupId: string;
  via: KnowledgeVia | null;
  subject?: KnowledgeVia | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const [open, setOpen] = useState<{ id: string; through: KnowledgeVia | null } | null>(null);
  const [gone, setGone] = useState(false);
  if (items.length === 0) return null;
  const openCard = (item: MessageKnowledge) => {
    const fromAdminGroup = item.available && item.source === 'admin_group' && !admin;
    if (fromAdminGroup && !via && !subject) {
      setGone(true);
      return;
    }
    setOpen({ id: item.id, through: via ?? (fromAdminGroup ? subject : null) });
  };
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      {items.map((item) => (
        <Card key={item.id} item={item} onOpen={() => openCard(item)} />
      ))}
      {open !== null && (
        <Suspense fallback={null}>
          {open.through ? (
            <SharedKnowledgeDialog
              via={open.through}
              itemId={open.id}
              groupId={groupId}
              onClose={() => setOpen(null)}
            />
          ) : (
            <KnowledgeDialog
              target={{ mode: 'view', id: open.id }}
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
