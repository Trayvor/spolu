import type { UserLanguage } from '@spolu/shared';
import { serverTexts } from '../../infra/i18n/index.js';

/**
 * The only translated part of a bulk email: the footer, in the recipient's language
 * (`infra/i18n/<code>.ts`). The rest of the email is whatever the admin wrote.
 */
export function bulkFooter(lang: UserLanguage): { reason: string; unsubscribe: string } {
  return serverTexts(lang).bulkEmail;
}
