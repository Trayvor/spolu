import type { BulkBlock, UserLanguage } from '@spolu/shared';
import { renderEmail } from '../../infra/email/render.js';
import { bulkFooter } from './texts.js';

export { LOGO_PATH } from '../../infra/email/render.js';

/**
 * The bulk email renderer (spec §3): the admin's blocks through the one email design
 * (`infra/email/render.ts`, shared with the system emails), with `{{name}}` and the formatted texts (Phase 31), and
 * the footer that says why the person gets it and links the unsubscribe.
 */

/** The public URL of an uploaded image (`GET /api/bulk-email/images/:id`, no session). */
export function imageUrl(publicUrl: string, imageId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/api/bulk-email/images/${encodeURIComponent(imageId)}`;
}

export type RenderInput = {
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  /** The phone version (Phase 31); `null` or left out while it follows the desktop version. */
  phoneBlocks?: BulkBlock[] | null;
  recipient: { name: string; language: UserLanguage };
  /** Already wrapped by the bulk sender (`unsubscribeHref`), e.g. `{unsubscribe:<url>}`. */
  unsubscribeHref: string;
  /** For image and logo URLs. */
  publicUrl: string;
  /**
   * Stored sizes of uploaded images by id (from `bulk_images`). Optional: without a size an
   * image is shown at the column width.
   */
  imageSizes?: ReadonlyMap<string, { width: number; height: number }>;
  /** The editor's preview only: block ids on the cells (`data-sp-block`), never sent. */
  markBlocks?: boolean;
};

export function renderCampaign(input: RenderInput): { html: string; text: string } {
  const { language, name } = input.recipient;
  const footer = bulkFooter(language);
  return renderEmail({
    subject: input.subject,
    preheader: input.preheader,
    blocks: input.blocks,
    phoneBlocks: input.phoneBlocks ?? null,
    language,
    name,
    footer: {
      lines: [footer.reason, footer.noReply],
      link: { label: footer.unsubscribe, href: input.unsubscribeHref },
    },
    publicUrl: input.publicUrl,
    imageUrl: (id) => imageUrl(input.publicUrl, id),
    imageSizes: input.imageSizes,
    markBlocks: input.markBlocks,
  });
}
