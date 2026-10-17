import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { KnowledgeView } from '@/features/knowledge/knowledge-view';
import { sharedKnowledgeQuery, type KnowledgeVia } from './api';
import { useChatPeople } from './chat-scope';

/**
 * Phase 28: a knowledge item attached to a message (or, Phase 33, linked to a ticket's text),
 * read-only, for a reader who reaches it only
 * through that message (a žiadateľ in their ticket chat): `GET /api/messages/:id/knowledge/:itemId`.
 * No edits, reminders or links into the knowledge base. A lazy chunk.
 */
export default function SharedKnowledgeDialog({
  via,
  itemId,
  groupId,
  onClose,
}: {
  via: KnowledgeVia;
  itemId: string;
  groupId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const query = useQuery(sharedKnowledgeQuery(via, itemId));
  // Mentions in the body resolve against the chat's people (the žiadateľ reads no group list).
  const people = useChatPeople(groupId).data;
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;
  const item = query.data;
  return (
    <SheetDialog onEscape={onClose} initialFocus={titleRef} testId="shared-knowledge-dialog">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('chat.knowledge.back')}>
        {null}
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        {item ? (
          <KnowledgeView
            ref={titleRef}
            item={item}
            nameOf={nameOf}
            onChanged={() => void query.refetch()}
          />
        ) : query.isError ? (
          <>
            <SheetDialogTitle ref={titleRef} tabIndex={-1} className="sr-only">
              {t('chat.knowledge.unavailable')}
            </SheetDialogTitle>
            <p role="alert" className="text-body">
              {t('chat.knowledge.unavailable')}
            </p>
          </>
        ) : (
          <SheetDialogTitle ref={titleRef} tabIndex={-1} aria-busy="true" className="sr-only">
            {t('chat.reactions.loading')}
          </SheetDialogTitle>
        )}
      </div>
    </SheetDialog>
  );
}
