import { describe, expect, it } from 'vitest';
import type { FileInfo, TaskDraft, TaskProposal } from '@spolu/shared';
import {
  canSubmit,
  cardByHand,
  cardsFromProposals,
  isTouched,
  toDrafts,
  type ReviewCard,
} from './review-model';

const file = (id: string): FileInfo => ({
  id,
  name: `${id}.pdf`,
  mime: 'application/pdf',
  size: 10,
  width: null,
  height: null,
  hasPreview: false,
});

const DRAFT: TaskDraft = {
  title: 'Task',
  description: '',
  assigneeIds: [],
  dueDate: null,
  urgent: false,
  fileIds: [],
  link: null,
};

let n = 0;
const card = (decision: ReviewCard['decision'], draft: Partial<TaskDraft> = {}): ReviewCard => ({
  key: `k${++n}`,
  draft: { ...DRAFT, ...draft },
  files: [],
  decision,
});
const approved = (draft: Partial<TaskDraft> = {}) => card('approved', draft);
const rejected = (draft: Partial<TaskDraft> = {}) => card('rejected', draft);

const proposal = (over: Partial<TaskProposal> = {}): TaskProposal => ({
  title: 'Send the report',
  description: 'By Friday',
  assigneeIds: ['u1'],
  dueDate: '2026-10-20',
  urgent: true,
  messageFileIds: [],
  link: null,
  ...over,
});

describe('review model', () => {
  it('cardsFromProposals makes pending cards with the proposed message files', () => {
    const cards = cardsFromProposals(
      [proposal({ messageFileIds: ['a', 'gone'] }), proposal({ title: 'Second' })],
      [file('a'), file('b')],
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      decision: 'pending',
      draft: {
        title: 'Send the report',
        description: 'By Friday',
        assigneeIds: ['u1'],
        dueDate: '2026-10-20',
        urgent: true,
        fileIds: ['a'],
      },
      files: [file('a')],
    });
    expect(cards[1]!.draft.fileIds).toEqual([]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(2);
  });

  it('a ticket’s project and event start every card (Phase 33 decision 12)', () => {
    const base = { projectId: 'p1', eventId: 'e1' };
    const [first] = cardsFromProposals([proposal()], [], base);
    expect(first!.draft).toMatchObject(base);
    expect(cardByHand('text', null, base).draft).toMatchObject(base);
    expect(toDrafts([{ ...first!, decision: 'approved' }], new Set())[0]).toMatchObject(base);
  });

  it('cardsFromProposals keeps the proposed link (owner bug report 2026-10-18)', () => {
    const [withLink, without] = cardsFromProposals(
      [proposal({ link: 'https://x.egrant.sk/app/7' }), proposal()],
      [],
    );
    expect(withLink!.draft.link).toBe('https://x.egrant.sk/app/7');
    expect(without!.draft.link).toBeNull();
  });

  it("cardByHand takes the source's link", () => {
    expect(cardByHand('Call the bank', 'https://x.egrant.sk/app/7').draft.link).toBe(
      'https://x.egrant.sk/app/7',
    );
  });

  it('cardByHand has an empty title and the message text as description', () => {
    expect(cardByHand('Call the bank')).toMatchObject({
      decision: 'pending',
      draft: { title: '', description: 'Call the bank', fileIds: [] },
      files: [],
    });
  });

  it('canSubmit needs every card decided and one approved', () => {
    expect(canSubmit([card('pending'), card('approved')])).toBe(false);
    expect(canSubmit([card('rejected'), card('rejected')])).toBe(false);
    expect(canSubmit([card('rejected'), card('approved')])).toBe(true);
    expect(canSubmit([])).toBe(false);
  });

  it('isTouched sees decisions and edits', () => {
    const initial = [card('pending'), card('pending')];
    expect(isTouched(initial, initial)).toBe(false);
    expect(isTouched([{ ...initial[0]!, decision: 'rejected' }, initial[1]!], initial)).toBe(true);
    expect(
      isTouched([initial[0]!, { ...initial[1]!, draft: { ...DRAFT, title: 'Other' } }], initial),
    ).toBe(true);
  });

  it('toDrafts keeps shown order and splits source files from uploads', () => {
    const tasks = toDrafts(
      [approved({ fileIds: ['mf', 'up'] }), rejected(), approved({ title: 'Second' })],
      new Set(['mf']),
    );
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ fileIds: ['up'], messageFileIds: ['mf'] });
    expect(tasks[1]).toMatchObject({ title: 'Second', fileIds: [], messageFileIds: [] });
  });
});
