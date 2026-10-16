import type {
  FileInfo,
  MessageDto,
  TaskDraft,
  TaskProposal,
  TasksFromMessage,
} from '@spolu/shared';

/** One proposed card in the review. */
export type ReviewCard = {
  key: string;
  /** `fileIds` = message files kept on the card + files uploaded in the review. */
  draft: TaskDraft;
  /** Details of `draft.fileIds`, for `TaskForm`. */
  files: FileInfo[];
  decision: 'pending' | 'approved' | 'rejected';
};

let counter = 0;
const nextKey = () => `card-${++counter}`;

/** Pending cards from the AI's proposals; proposed files that are not the message's are dropped. */
export function cardsFromProposals(
  proposals: TaskProposal[],
  messageFiles: FileInfo[],
): ReviewCard[] {
  return proposals.map((p) => {
    const files = p.messageFileIds
      .map((id) => messageFiles.find((f) => f.id === id))
      .filter((f): f is FileInfo => f !== undefined);
    return {
      key: nextKey(),
      draft: {
        title: p.title,
        description: p.description,
        assigneeIds: p.assigneeIds,
        dueDate: p.dueDate,
        urgent: p.urgent,
        fileIds: files.map((f) => f.id),
        link: null,
      },
      files,
      decision: 'pending',
    };
  });
}

/** The card offered when the AI found no tasks: empty title, the message text as description. */
export function cardByHand(message: MessageDto): ReviewCard {
  return {
    key: nextKey(),
    draft: {
      title: '',
      description: message.body,
      assigneeIds: [],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
    },
    files: [],
    decision: 'pending',
  };
}

/** Every card decided and at least one approved. */
export function canSubmit(cards: ReviewCard[]): boolean {
  return (
    cards.every((c) => c.decision !== 'pending') && cards.some((c) => c.decision === 'approved')
  );
}

/** Something was decided or edited since the cards arrived (closing then asks first). */
export function isTouched(cards: ReviewCard[], initial: ReviewCard[]): boolean {
  if (cards.length !== initial.length) return true;
  return cards.some((card, i) => {
    const before = initial[i];
    return (
      before === undefined ||
      card.decision !== before.decision ||
      JSON.stringify(card.draft) !== JSON.stringify(before.draft)
    );
  });
}

/**
 * The create request: approved cards in the order shown. Ids in `messageFileIds` (the source
 * message's files) go to `messageFileIds`, to be copied; the rest were uploaded in the review.
 */
export function toRequest(
  messageId: string,
  cards: ReviewCard[],
  messageFileIds: Set<string>,
): TasksFromMessage {
  return {
    messageId,
    tasks: cards
      .filter((c) => c.decision === 'approved')
      .map(({ draft }) => ({
        ...draft,
        fileIds: draft.fileIds.filter((id) => !messageFileIds.has(id)),
        messageFileIds: draft.fileIds.filter((id) => messageFileIds.has(id)),
      })),
  };
}
