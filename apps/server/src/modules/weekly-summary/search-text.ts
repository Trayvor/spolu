import type { WeeklySummaryContent } from '@spolu/shared';

/**
 * The plain text of a summary for the archive search (spec §6.1): intro, every item and the
 * closing, one per line. Folded in SQL (`spolu_fold`); never sent to the web.
 */
export function searchText(content: WeeklySummaryContent): string {
  return [
    content.intro,
    ...content.done.map((i) => i.text),
    ...content.waiting.map((i) => i.text),
    ...content.upcoming.map((i) => i.text),
    content.closing,
  ]
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join('\n');
}
