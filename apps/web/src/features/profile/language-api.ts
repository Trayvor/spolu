import { isLanguage } from '@/i18n/detect';
import { apiSend } from '@/lib/api';

/**
 * Store the UI language on the server (emails and pushes use it). Unknown codes are ignored.
 * Its own module: the header's language menu needs it eagerly, and `./api` imports the bulk
 * email and notification schemas of `@spolu/shared`, which the initial JS should not carry.
 */
export async function saveLanguage(language: string): Promise<void> {
  if (!isLanguage(language)) return;
  await apiSend('PUT', '/me/language', { language });
}
