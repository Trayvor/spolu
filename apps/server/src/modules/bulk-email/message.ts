import { imageIdsOfBlocks, upgradeBlocks, type BulkBlock, type UserLanguage } from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { BulkEmailSender, BulkMessage } from '../../infra/email/bulk.js';
import { renderCampaign } from './render.js';
import { signUnsubscribeToken, unsubscribeUrls } from './token.js';

/** What a campaign says; the same for every person. `phoneBlocks` null: phone follows desktop. */
export type CampaignContent = {
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  phoneBlocks: BulkBlock[] | null;
};

/** The image ids of both versions, inside split containers too, for `imageSizes` / `imageExists`. */
export const imageIdsOf = (content: {
  blocks: readonly BulkBlock[];
  phoneBlocks?: readonly BulkBlock[] | null;
}): string[] => imageIdsOfBlocks(content.blocks, content.phoneBlocks);

/** The content of a raw `bulk_campaigns` row, upgraded to content version 2 (spec §2.3). */
export function contentOf(row: {
  subject: string;
  preheader: string;
  blocks: unknown;
  phone_blocks: unknown;
  content_version: number;
}): CampaignContent {
  return {
    subject: row.subject,
    preheader: row.preheader,
    blocks: upgradeBlocks(row.content_version, row.blocks),
    phoneBlocks:
      row.phone_blocks === null || row.phone_blocks === undefined
        ? null
        : upgradeBlocks(row.content_version, row.phone_blocks),
  };
}

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
    phoneBlocks: content.phoneBlocks,
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
