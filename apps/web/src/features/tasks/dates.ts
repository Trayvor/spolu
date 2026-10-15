import type { BucketKind } from '@spolu/shared';

const bratislava = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' });

/** Today's calendar date in Bratislava as `YYYY-MM-DD` (due dates are plain dates, not instants). */
export function todayInBratislava(now: Date = new Date()): string {
  return bratislava.format(now);
}

/** Past due and still open; anything in the Completed bucket is never overdue. */
export function isOverdue(dueDate: string | null, bucketKind: BucketKind, today: string): boolean {
  return dueDate !== null && bucketKind !== 'done' && dueDate < today;
}

/** A due date as "18 Oct" in the interface language (English day-first, like Slovak). */
export function formatDue(dueDate: string, language: string): string {
  return new Date(`${dueDate}T00:00:00Z`).toLocaleDateString(
    /^en\b/.test(language) ? 'en-GB' : language,
    {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    },
  );
}

/** An instant as "15 Oct 2026" (Bratislava calendar day) in the interface language. */
export function formatCreated(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(/^en\b/.test(language) ? 'en-GB' : language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Bratislava',
  });
}
