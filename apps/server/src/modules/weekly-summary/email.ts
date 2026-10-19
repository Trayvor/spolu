import { WeeklySummarySections, type UserLanguage, type WeeklySummaryContent } from '@spolu/shared';
import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';

/**
 * The weekly summary email (spec §8.1) in the one email design: the fixed headings, button and
 * footer in the recipient's language, the written text (intro, items, closing) as the manager
 * left it, escaped by the renderer. A recurring email, so it carries a personal unsubscribe line
 * and the RFC 8058 one-click headers.
 */
export function summaryEmail(i: {
  to: string;
  lang: UserLanguage;
  publicUrl: string;
  groupId: string;
  groupName: string;
  range: string;
  content: WeeklySummaryContent;
  unsubscribe: { page: string; oneClick: string };
  test?: boolean;
}): EmailMessage {
  const t = serverTexts(i.lang).weeklySummary;
  const base = i.publicUrl.replace(/\/+$/, '');
  const subject = `${i.test ? `${t.testPrefix} ` : ''}${t.subject(i.groupName, i.range)}`;
  const sections = WeeklySummarySections.filter((s) => i.content[s].length > 0).map((s) => ({
    heading: t[s],
    paragraphs: [i.content[s].map((item) => `• ${item.text}`).join('\n')],
  }));
  const closing = i.content.closing.trim();
  return buildEmail({
    to: i.to,
    lang: i.lang,
    publicUrl: i.publicUrl,
    subject,
    heading: t.heading,
    paragraphs: i.content.intro.trim() === '' ? [] : [i.content.intro],
    sections: [
      ...sections,
      {
        paragraphs: closing === '' ? [] : [closing],
        button: { label: t.button, url: `${base}/groups/${i.groupId}/overview` },
      },
    ],
    footerLines: [t.footer(i.groupName, i.unsubscribe.page)],
    headers: {
      'List-Unsubscribe': `<${i.unsubscribe.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/** To a manager on Friday: their groups' drafts are ready (spec §12.7). */
export function reminderEmail(i: {
  to: string;
  lang: UserLanguage;
  publicUrl: string;
  groups: string[];
}): EmailMessage {
  const t = serverTexts(i.lang).weeklySummary.reminder;
  const base = i.publicUrl.replace(/\/+$/, '');
  const named = i.groups.slice(0, 2);
  return buildEmail({
    to: i.to,
    lang: i.lang,
    publicUrl: i.publicUrl,
    subject: t.subject(i.groups.length),
    paragraphs: [t.body(named, i.groups.length - named.length)],
    button: { label: t.button, url: `${base}/weekly-summaries` },
  });
}
