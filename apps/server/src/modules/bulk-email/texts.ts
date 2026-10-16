import type { UserLanguage } from '@spolu/shared';

/**
 * The only translated part of a bulk email: the footer, in the recipient's language. The rest
 * of the email is whatever the admin wrote.
 */
export const BULK_FOOTER: Record<UserLanguage, { reason: string; unsubscribe: string }> = {
  sk: {
    reason: 'Tento e-mail dostávate, pretože máte účet v Spolu by eGrant.',
    unsubscribe: 'Odhlásiť sa z odberu',
  },
  en: {
    reason: 'You get this email because you have an account in Spolu by eGrant.',
    unsubscribe: 'Unsubscribe',
  },
};
