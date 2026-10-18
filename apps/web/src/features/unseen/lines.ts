import type { TFunction } from 'i18next';
import type { BucketLabel, UnseenSummary, UnseenSummaryLine } from '@spolu/shared';
import { formatDue } from '@/features/tasks/dates';

const BUCKET_KEYS = {
  todo: 'todo',
  egrant_review: 'egrantReview',
  client_review: 'clientReview',
  done: 'done',
} as const;

function bucketName(t: TFunction, bucket: BucketLabel): string | null {
  if (bucket.kind === 'custom') return bucket.name;
  if (bucket.kind === 'client_review' && !bucket.name) return t('unseen.buckets.clientReviewAnon');
  return t(`unseen.buckets.${BUCKET_KEYS[bucket.kind]}`, { group: bucket.name ?? '' });
}

/** The day after `day` (`YYYY-MM-DD`). */
function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** One summary line as text ("Presunuté: Na spracovanie → Hotové", "Priradené vám"…). */
export function unseenLineText(
  t: TFunction,
  line: UnseenSummaryLine,
  language: string,
  today: string,
): string {
  switch (line.kind) {
    case 'moved': {
      const from = line.from && bucketName(t, line.from);
      const to = line.to && bucketName(t, line.to);
      if (from && to) return t('unseen.lines.moved', { from, to });
      if (to) return t('unseen.lines.movedTo', { to });
      return t('unseen.lines.movedGeneric');
    }
    case 'deadline':
      if (line.dueDate === today) return t('unseen.lines.deadlineToday');
      if (line.dueDate === nextDay(today)) return t('unseen.lines.deadlineTomorrow');
      return t('unseen.lines.deadline', { date: formatDue(line.dueDate, language) });
    case 'messages':
      return line.authors.length > 0
        ? t('unseen.lines.messages', { count: line.count, authors: line.authors.join(', ') })
        : t('unseen.lines.messagesOnly', { count: line.count });
    case 'mentions':
      return line.authors.length > 0
        ? t('unseen.lines.mentions', { authors: line.authors.join(', ') })
        : t('unseen.lines.mentionsOnly');
    case 'status':
      return t('unseen.lines.status', { status: t(`unseen.status.${line.status}`) });
    case 'tasks':
      return t('unseen.lines.tasks', { count: line.count });
    default:
      return t(`unseen.lines.${line.kind}`);
  }
}

/** Every line of a summary as text, then "and N more" when it has more. */
export function unseenSummaryTexts(
  t: TFunction,
  summary: UnseenSummary,
  language: string,
  today: string,
): string[] {
  const texts = summary.lines.map((line) => unseenLineText(t, line, language, today));
  if (summary.more > 0) texts.push(t('unseen.more', { count: summary.more }));
  return texts;
}
