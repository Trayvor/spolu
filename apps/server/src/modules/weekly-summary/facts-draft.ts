import { randomUUID } from 'node:crypto';
import {
  WEEKLY_SUMMARY_LIMITS,
  type UserLanguage,
  type WeeklySummaryContent,
  type WeeklySummaryItem,
} from '@spolu/shared';
import { serverTexts } from '../../infra/i18n/index.js';
import type { Fact, Facts } from './facts.js';
import { dayText } from './week.js';

/**
 * The draft built without AI (spec §5): a fixed intro and closing in the draft language and one
 * item per fact with its own title; waiting and upcoming items carry their date.
 */
export function factsDraft(facts: Facts, lang: UserLanguage, range: string): WeeklySummaryContent {
  const t = serverTexts(lang).weeklySummary;
  const items = (list: Fact[], withDate: boolean): WeeklySummaryItem[] =>
    list.slice(0, WEEKLY_SUMMARY_LIMITS.items).map((fact) => ({
      id: randomUUID(),
      ref: fact.ref,
      text: cut(withDate && fact.date ? `${fact.text} – ${dayText(lang, fact.date)}` : fact.text),
    }));
  return {
    intro: t.factsIntro(range),
    done: items(facts.done, false),
    waiting: items(facts.waiting, true),
    upcoming: items(facts.upcoming, true),
    closing: t.factsClosing,
  };
}

const cut = (text: string): string => {
  const chars = Array.from(text.trim());
  return chars.length > WEEKLY_SUMMARY_LIMITS.item
    ? `${chars.slice(0, WEEKLY_SUMMARY_LIMITS.item - 1).join('')}…`
    : chars.join('');
};
