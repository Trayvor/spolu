import type { BucketLabel, UserLanguage } from '@spolu/shared';

/** Server-side copy for push and email, in the user's language. */
export type Texts = {
  sentFile(name: string): string;
  moved(label: string): string;
  movedGeneric: string;
  assigned(name: string): string;
  deadline(daysLeft: number): string;
  urgent: string;
  bucket(label: BucketLabel): string;
  digestSubject(count: number, group: string): string;
  digestButton(group: string): string;
  reminderDue(time: string): string;
  reminderLine(title: string, time: string): string;
  /** The SUMMARY of a task's all-day deadline event in the calendar export. */
  deadlineEvent(title: string): string;
};

const en: Texts = {
  sentFile: (name) => `${name} sent a file`,
  moved: (label) => `Moved to ${label}`,
  movedGeneric: 'Task moved',
  assigned: (name) => `${name} assigned you to this task`,
  deadline: (d) => (d === 1 ? 'Due tomorrow' : `Due in ${d} days`),
  urgent: 'Urgent: still open',
  bucket: (l) => {
    switch (l.kind) {
      case 'todo':
        return 'To do';
      case 'egrant_review':
        return 'eGrant review';
      case 'client_review':
        return `${l.name ?? ''} review`.trim();
      case 'done':
        return 'Completed';
      case 'custom':
        return l.name ?? '';
    }
  },
  digestSubject: (n, g) => (n === 1 ? `1 new message in ${g}` : `${n} new messages in ${g}`),
  digestButton: (g) => `Open ${g}`,
  reminderDue: (time) => `Reminder for ${time}`,
  reminderLine: (title, time) => `Reminder: ${title}, ${time}`,
  deadlineEvent: (title) => `Deadline: ${title}`,
};

function skMessages(n: number): string {
  if (n === 1) return 'nová správa';
  if (n >= 2 && n <= 4) return 'nové správy';
  return 'nových správ';
}

const sk: Texts = {
  sentFile: (name) => `${name} poslal(a) súbor`,
  moved: (label) => `Presunuté do ${label}`,
  movedGeneric: 'Úloha presunutá',
  assigned: (name) => `${name} vás priradil(a) k úlohe`,
  deadline: (d) => (d === 1 ? 'Termín zajtra' : d <= 4 ? `Termín o ${d} dni` : `Termín o ${d} dní`),
  urgent: 'Urgentné: stále otvorené',
  bucket: (l) => {
    switch (l.kind) {
      case 'todo':
        return 'Na spracovanie';
      case 'egrant_review':
        return 'Kontrola eGrant';
      case 'client_review':
        return `Kontrola ${l.name ?? ''}`.trim();
      case 'done':
        return 'Hotové';
      case 'custom':
        return l.name ?? '';
    }
  },
  digestSubject: (n, g) => `${n} ${skMessages(n)} v ${g}`,
  digestButton: (g) => `Otvoriť ${g}`,
  reminderDue: (time) => `Pripomienka na ${time}`,
  reminderLine: (title, time) => `Pripomienka: ${title}, ${time}`,
  deadlineEvent: (title) => `Termín: ${title}`,
};

export function texts(lang: UserLanguage): Texts {
  return lang === 'sk' ? sk : en;
}

/** A reminder time as the team reads it: Bratislava wall clock, e.g. "Sun 25 Oct, 10:00". */
export function formatReminderTime(iso: string | undefined | null, lang: UserLanguage): string {
  const at = new Date(iso ?? NaN);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', {
    timeZone: 'Europe/Bratislava',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}
