import type {
  FileInfo,
  KnowledgeItemDto,
  MessageDto,
  TaskDraft,
  TaskFromMessageDraft,
  TaskProposal,
  TicketDto,
} from '@spolu/shared';

/**
 * What is turned into tasks: a chat message, a ticket (Phase 21), or a meeting's action items
 * (Phase 30, a knowledge item of type `meeting`).
 */
export type SplitSource =
  | { kind: 'message'; message: MessageDto }
  | { kind: 'ticket'; ticket: TicketDto }
  | { kind: 'meeting'; item: KnowledgeItemDto };

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

/**
 * Pending cards from the AI's proposals; proposed files that are not the message's are dropped.
 * `base` starts every card with fields of the source: a ticket's project and event (Phase 33
 * decision 12).
 */
export function cardsFromProposals(
  proposals: TaskProposal[],
  messageFiles: FileInfo[],
  base: Partial<TaskDraft> = {},
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
        ...base,
      },
      files,
      decision: 'pending',
    };
  });
}

/** The card offered when the AI found no tasks: empty title, the source's text as description. */
export function cardByHand(text: string, base: Partial<TaskDraft> = {}): ReviewCard {
  return {
    key: nextKey(),
    draft: {
      title: '',
      description: text,
      assigneeIds: [],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
      ...base,
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
 * The approved cards in the order shown. Ids in `sourceFileIds` (the source's files) go to
 * `messageFileIds`, to be copied; the rest were uploaded in the review.
 */
export function toDrafts(cards: ReviewCard[], sourceFileIds: Set<string>): TaskFromMessageDraft[] {
  return cards
    .filter((c) => c.decision === 'approved')
    .map(({ draft }) => ({
      ...draft,
      fileIds: draft.fileIds.filter((id) => !sourceFileIds.has(id)),
      messageFileIds: draft.fileIds.filter((id) => sourceFileIds.has(id)),
    }));
}
