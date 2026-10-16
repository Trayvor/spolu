import type { BulkBlock, UserLanguage } from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { BulkEmailSender, BulkMessage } from '../../infra/email/bulk.js';
import { renderCampaign } from './render.js';
import { signUnsubscribeToken, unsubscribeUrls } from './token.js';

/** What a campaign says; the same for every person. */
export type CampaignContent = { subject: string; preheader: string; blocks: BulkBlock[] };

/** The image ids of a block list, for `imageSizes` / `imageExists`. */
export const imageIdsOf = (blocks: readonly BulkBlock[]): string[] =>
  blocks.flatMap((b) => (b.type === 'image' ? [b.imageId] : []));

/**
 * The email of one person (spec §4, §5): rendered with their name and language, with the
 * footer link and the one-click URL of their signed token for `tokenCampaignId` (the campaign,
 * or `test`). Deterministic, so a retry with the same idempotency key sends the same body.
 */
export function personalMessage(
  deps: { config: Pick<Config, 'appSecret' | 'publicUrl'>; bulkEmail: BulkEmailSender },
  content: CampaignContent,
  imageSizes: ReadonlyMap<string, { width: number; height: number }>,
  person: { userId: string; email: string; name: string; language: UserLanguage },
  ids: { tokenCampaignId: string; idempotencyKey: string; postback: string; subject?: string },
): BulkMessage {
  const { config, bulkEmail } = deps;
  const token = signUnsubscribeToken(config.appSecret, person.userId, ids.tokenCampaignId);
  const urls = unsubscribeUrls(config.publicUrl, token);
  const { html, text } = renderCampaign({
    subject: content.subject,
    preheader: content.preheader,
    blocks: content.blocks,
    recipient: { name: person.name, language: person.language },
    unsubscribeHref: bulkEmail.unsubscribeHref(urls.page),
    publicUrl: config.publicUrl,
    imageSizes,
  });
  return {
    to: [person.email],
    subject: ids.subject ?? content.subject,
    html,
    text,
    idempotencyKey: ids.idempotencyKey,
    postback: ids.postback,
    unsubscribeUrl: urls.page,
    oneClickUrl: urls.oneClick,
  };
}
