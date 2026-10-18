import { beforeEach, describe, expect, it } from 'vitest';
import { i18n, setLanguage } from '@/i18n';
import { unseenSummaryTexts } from './lines';

const t = i18n.t.bind(i18n);
const today = '2026-10-18';
const texts = (lines: Parameters<typeof unseenSummaryTexts>[1]['lines'], more = 0) =>
  unseenSummaryTexts(t, { lines, more }, i18n.language, today);

describe('unseen summary lines (2026-10-18)', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });

  it('a task: moved, assigned, messages with authors, the deadline', () => {
    expect(
      texts([
        {
          kind: 'moved',
          from: { kind: 'todo', name: null },
          to: { kind: 'done', name: null },
        },
        { kind: 'assigned' },
        { kind: 'messages', count: 2, authors: ['Jana'] },
        { kind: 'messages', count: 1, authors: [] },
        { kind: 'mentions', count: 1, authors: ['Eva'] },
        { kind: 'deadline', dueDate: '2026-10-19' },
        { kind: 'deadline', dueDate: '2026-10-18' },
      ]),
    ).toEqual([
      'Presunuté: Na spracovanie → Hotové',
      'Priradené vám',
      '2 nové správy (Jana)',
      '1 nová správa',
      'Zmienka od: Eva',
      'Termín zajtra',
      'Termín dnes',
    ]);
  });

  it("a client's review and a custom column are named; an unknown one is left out", () => {
    expect(
      texts([
        {
          kind: 'moved',
          from: { kind: 'client_review', name: 'ABC' },
          to: { kind: 'custom', name: 'Podpis' },
        },
        { kind: 'moved', from: null, to: { kind: 'done', name: null } },
        { kind: 'moved', from: null, to: null },
      ]),
    ).toEqual(['Presunuté: Kontrola ABC → Podpis', 'Presunuté do: Hotové', 'Presunuté']);
  });

  it('a ticket: new, status, details, tasks, time; then "and N more"', () => {
    expect(
      texts(
        [
          { kind: 'created' },
          { kind: 'status', status: 'resolved' },
          { kind: 'updated' },
          { kind: 'tasks', count: 2 },
          { kind: 'timeMissing' },
        ],
        2,
      ),
    ).toEqual([
      'Nový tiket',
      'Stav: Vyriešený',
      'Upravené údaje',
      '2 nové úlohy z tiketu',
      'Doplňte svoj čas',
      'a 2 ďalšie zmeny',
    ]);
  });

  it('every language has every text (English)', async () => {
    await setLanguage('en');
    expect(
      texts([{ kind: 'assigned' }, { kind: 'messages', count: 1, authors: ['Jana'] }], 1),
    ).toEqual(['Assigned to you', '1 new message (Jana)', 'and 1 more change']);
  });
});
