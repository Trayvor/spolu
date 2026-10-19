import type {
  WeeklySummaryArchiveItem,
  WeeklySummaryDto,
  WeeklySummaryListItem,
} from '@spolu/shared';
import { isoWeek } from './format';

/** Tests only: fake weekly summary answers. */

const NOW = '2026-10-16T10:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const listItem = (
  over: Partial<WeeklySummaryListItem> & { id: string },
): WeeklySummaryListItem => ({
  groupId: `g-${over.id}`,
  groupName: `Firma ${over.id}`,
  week: isoWeek(new Date()),
  status: 'draft',
  skipReason: null,
  source: 'facts',
  aiFailed: false,
  itemCount: 8,
  recipientCount: 4,
  updatedAt: NOW,
  sentAt: null,
  managedByMe: true,
  ...over,
});

export const content = () => ({
  intro: 'Dobrý deň',
  done: [
    { id: uuid(1), ref: { kind: 'task' as const, id: 't1' }, text: 'Rozpočet' },
    { id: uuid(2), ref: null, text: 'Podali sme žiadosť o platbu' },
  ],
  waiting: [],
  upcoming: [],
  closing: 'S pozdravom',
});

export const dto = (over: Partial<WeeklySummaryDto> = {}): WeeklySummaryDto => ({
  ...listItem({ id: 's1', groupName: 'Firma A' }),
  windowStart: '2026-10-09T05:00:00.000Z',
  windowEnd: '2026-10-16T05:00:00.000Z',
  language: 'sk',
  content: content(),
  version: 3,
  canEdit: true,
  revisionCount: 0,
  recipients: [
    { name: 'Jana Nováková', language: 'sk' },
    { name: 'Marco Rossi', language: 'it' },
  ],
  refs: { [uuid(1)]: { kind: 'task', title: 'Rozpočet', url: '/groups/g-s1/tasks/t1' } },
  updatedBy: null,
  sentBy: null,
  groupDeactivated: false,
  ...over,
});

export const archiveItem = (
  over: Partial<WeeklySummaryArchiveItem> & { id: string },
): WeeklySummaryArchiveItem => ({
  groupId: 'g1',
  groupName: 'Firma A',
  groupDeactivated: false,
  week: '2026-W42',
  windowStart: '2026-10-09T05:00:00.000Z',
  windowEnd: '2026-10-16T05:00:00.000Z',
  status: 'sent',
  skipReason: null,
  sentAt: '2026-10-17T07:00:00.000Z',
  sentBy: { name: 'Jana Nováková' },
  content: content(),
  ...over,
});
