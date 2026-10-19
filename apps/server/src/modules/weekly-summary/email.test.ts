import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WeeklySummaryContent } from '@spolu/shared';
import { serverTexts } from '../../infra/i18n/index.js';
import { reminderEmail, summaryEmail } from './email.js';

const item = (text: string) => ({ id: randomUUID(), ref: null, text });
const content: WeeklySummaryContent = {
  intro: 'Buongiorno',
  done: [item('<b>x</b>'), item('Bilancio pronto')],
  waiting: [],
  upcoming: [item('Scadenza')],
  closing: 'Cordiali saluti',
};
const base = {
  to: 'c@example.com',
  lang: 'it' as const,
  publicUrl: 'https://help.egrant.sk',
  groupId: 'g1',
  groupName: 'Firma',
  range: '13/10 – 17/10/2026',
  content,
  unsubscribe: {
    page: 'https://help.egrant.sk/weekly-summary/unsubscribe/t',
    oneClick: 'https://help.egrant.sk/api/weekly-summary/unsubscribe/t/one-click',
  },
};

describe('weekly summary email', () => {
  it("the email has the sections in the recipient's language and the text as written", () => {
    const t = serverTexts('it').weeklySummary;
    const email = summaryEmail(base);
    expect(email.subject).toBe(t.subject('Firma', base.range));
    // the plain-text part writes headings in capitals
    const text = email.text.toLowerCase();
    expect(text).toContain(t.heading.toLowerCase());
    expect(text).toContain(t.done.toLowerCase());
    expect(text).toContain(t.upcoming.toLowerCase());
    expect(text).not.toContain(t.waiting.toLowerCase()); // an empty section is left out
    expect(email.text).toContain('• <b>x</b>');
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(email.text).toContain('https://help.egrant.sk/groups/g1/overview');
    expect(email.text).toContain('Cordiali saluti');
  });

  it('the email carries the one-click unsubscribe headers and footer line', () => {
    const email = summaryEmail(base);
    expect(email.headers).toEqual({
      'List-Unsubscribe': `<${base.unsubscribe.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(email.text).toContain(
      serverTexts('it').weeklySummary.footer('Firma', base.unsubscribe.page),
    );
  });

  it('a test email has the [Test] prefix', () => {
    expect(summaryEmail({ ...base, test: true }).subject.startsWith('[Test] ')).toBe(true);
  });

  it('the reminder names two groups and counts the rest', () => {
    const email = reminderEmail({
      to: 'm@example.com',
      lang: 'sk',
      publicUrl: 'https://help.egrant.sk',
      groups: ['Firma A', 'Firma B', 'Firma C'],
    });
    expect(email.subject).toBe('Týždenné prehľady na kontrolu: 3');
    expect(email.text).toContain('Firma A, Firma B a 1 ďalší');
    expect(email.text).toContain('https://help.egrant.sk/weekly-summaries');
  });
});
