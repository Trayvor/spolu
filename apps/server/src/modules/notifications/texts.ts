import type { BucketLabel, UserLanguage } from '@spolu/shared';

/** Server-side copy for push and email, in the user's language. */
export type Texts = {
  sentFile(name: string): string;
  moved(label: string): string;
  assigned(name: string): string;
  deadline(daysLeft: number): string;
  urgent: string;
  bucket(label: BucketLabel): string;
  digestSubject(count: number, group: string): string;
  digestButton(group: string): string;
};

const en: Texts = {
  sentFile: (name) => `${name} sent a file`,
  moved: (label) => `Moved to ${label}`,
  assigned: (name) => `${name} assigned you to this task`,
  deadline: (d) => (d === 1 ? 'Deadline tomorrow' : `Deadline in ${d} days`),
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
};

function skMessages(n: number): string {
  if (n === 1) return 'nová správa';
  if (n >= 2 && n <= 4) return 'nové správy';
  return 'nových správ';
}

const sk: Texts = {
  sentFile: (name) => `${name} poslal(a) súbor`,
  moved: (label) => `Presunuté do ${label}`,
  assigned: (name) => `${name} vás priradil(a) k úlohe`,
  deadline: (d) => (d === 1 ? 'Termín zajtra' : `Termín o ${d} dni`),
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
};

export function texts(lang: UserLanguage): Texts {
  return lang === 'sk' ? sk : en;
}
