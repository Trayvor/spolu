import { useTranslation } from 'react-i18next';
import type { LinkedKnowledge } from '@spolu/shared';
import type { KnowledgeVia } from '@/features/chat/api';
import { KnowledgeCardList } from '@/features/chat/knowledge-cards';

/**
 * The cards of the knowledge attached to a description (Phase 33 part P5), as the chat shows a
 * message's; a lazy chunk with the `chat` texts.
 */
export default function LinkedCards({
  items,
  groupId,
  via,
  subject = null,
}: {
  items: LinkedKnowledge;
  groupId: string;
  via: KnowledgeVia | null;
  /** The saved description's owner: a client opens an admin-group item through it (Phase 34). */
  subject?: KnowledgeVia | null;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('chat.knowledge.attached')}>
      <KnowledgeCardList items={items} groupId={groupId} via={via} subject={subject} />
    </section>
  );
}
