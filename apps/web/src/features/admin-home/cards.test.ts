import { describe, expect, it } from 'vitest';
import type { ChatMentionItem, DescriptionMentionItem } from '@spolu/shared';
import { addDays, dayGroup, descriptionTitle, mentionTarget, taskGroup } from './cards';

const mention = (over: Partial<ChatMentionItem>): ChatMentionItem => ({
  source: 'chat',
  messageId: 'm1',
  channelId: 'c1',
  taskId: null,
  ticketId: null,
  parentId: null,
  groupId: 'g1',
  groupName: 'ABC',
  authorName: 'Eva',
  excerpt: 'Hi',
  createdAt: '2026-10-16T10:00:00.000Z',
  ...over,
});

describe('mentionTarget', () => {
  it('a mention in a ticket chat opens the ticket page at the message', () => {
    expect(mentionTarget(mention({ ticketId: 'k1', parentId: 'r1' }))).toEqual({
      to: '/tickets/$ticketId',
      params: { ticketId: 'k1' },
      search: { thread: 'r1', message: 'm1', c: 'c1' },
    });
  });

  it('a group chat mention opens the Chat tab', () => {
    expect(mentionTarget(mention({}))).toEqual({
      to: '/groups/$groupId/chat',
      params: { groupId: 'g1' },
      search: { message: 'm1', c: 'c1' },
    });
  });
});

describe('mentions in descriptions (2026-10-18)', () => {
  const described = (over: Partial<DescriptionMentionItem>): DescriptionMentionItem => ({
    source: 'description',
    id: 'e1',
    subjectKind: 'task',
    subjectId: 's1',
    title: 'Budget',
    ticketNumber: null,
    groupId: 'g1',
    groupName: 'ABC',
    authorName: 'Eva',
    createdAt: '2026-10-16T10:00:00.000Z',
    ...over,
  });

  it('each opens its subject where its notification does', () => {
    expect(mentionTarget(described({}))).toEqual({
      to: '/groups/$groupId/tasks/$taskId',
      params: { groupId: 'g1', taskId: 's1' },
    });
    expect(mentionTarget(described({ subjectKind: 'ticket' }))).toEqual({
      to: '/tickets/$ticketId',
      params: { ticketId: 's1' },
    });
    expect(mentionTarget(described({ subjectKind: 'project' }))).toEqual({
      to: '/groups/$groupId/overview',
      params: { groupId: 'g1' },
      search: { project: 's1' },
    });
    expect(mentionTarget(described({ subjectKind: 'knowledge' }))).toEqual({
      to: '/groups/$groupId/knowledge',
      params: { groupId: 'g1' },
      search: { k: 's1' },
    });
  });

  it('a ticket is named by its number and subject', () => {
    expect(descriptionTitle(described({}))).toBe('Budget');
    expect(
      descriptionTitle(described({ subjectKind: 'ticket', ticketNumber: 7, title: 'Login' })),
    ).toBe('#7 Login');
    expect(descriptionTitle(described({ subjectKind: 'ticket', ticketNumber: 7, title: '' }))).toBe(
      '#7',
    );
  });
});

describe('phone sheet groups', () => {
  const today = '2026-10-17';

  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('tasks: overdue, today, this week (6 days ahead), later, no date', () => {
    expect(taskGroup('2026-10-16', today)).toBe('overdue');
    expect(taskGroup(today, today)).toBe('today');
    expect(taskGroup('2026-10-23', today)).toBe('week');
    expect(taskGroup('2026-10-24', today)).toBe('later');
    expect(taskGroup(null, today)).toBe('noDate');
  });

  it('days in Bratislava time: earlier, yesterday, today, tomorrow, later', () => {
    // 23:30 UTC on the 16th is already the 17th in Bratislava (UTC+2 in October).
    expect(dayGroup('2026-10-16T23:30:00.000Z', today)).toBe('today');
    expect(dayGroup('2026-10-16T10:00:00.000Z', today)).toBe('yesterday');
    expect(dayGroup('2026-10-10T10:00:00.000Z', today)).toBe('earlier');
    expect(dayGroup('2026-10-18T10:00:00.000Z', today)).toBe('tomorrow');
    expect(dayGroup('2026-10-20T10:00:00.000Z', today)).toBe('later');
  });
});
