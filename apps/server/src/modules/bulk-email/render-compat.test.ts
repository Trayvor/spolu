import { describe, expect, it } from 'vitest';
import { upgradeBlocks } from '@spolu/shared';
import { renderCampaign } from './render.js';

/**
 * Phase 31 compatibility: campaigns saved before the builder v2 (content version 1) must render
 * byte for byte as they did. The snapshots in `__snapshots__/render-compat.test.ts.snap` were
 * recorded with the Phase 23 renderer, before any v2 change; never update them to make a
 * failing test pass.
 */

const V1_BLOCKS = [
  { id: 'l', type: 'logo', align: 'center' },
  { id: 'h1', type: 'heading', text: 'Dobrý deň, {{name}}', align: 'left' },
  { id: 'h2', type: 'heading', text: 'Centred <b>&</b>', align: 'center' },
  {
    id: 't1',
    type: 'text',
    text: 'Máme pre vás **novinky** o výzvach, {{name}}.\nDruhý riadok s https://egrant.sk/a?b=1&c=2.\n\n\nNový **odsek** a ** nedokončené.',
    align: 'left',
  },
  { id: 't2', type: 'text', text: 'Centred **bold {{name}}** text', align: 'center' },
  { id: 't3', type: 'text', text: '', align: 'left' },
  { id: 'i1', type: 'image', imageId: 'img-small', alt: 'Small "photo"' },
  { id: 'i2', type: 'image', imageId: 'img-large', alt: 'Large', href: 'https://egrant.sk/x' },
  { id: 'i3', type: 'image', imageId: 'img-unknown', alt: 'Unknown size' },
  { id: 'd', type: 'divider' },
  { id: 'b1', type: 'button', label: 'Otvoriť eGrant', url: 'https://egrant.sk', align: 'left' },
  { id: 'b2', type: 'button', label: 'Napísať', url: 'mailto:info@egrant.sk', align: 'center' },
  { id: 'l2', type: 'logo', align: 'left' },
];

const SIZES = new Map([
  ['img-small', { width: 300, height: 150 }],
  ['img-large', { width: 1200, height: 601 }],
]);

function renderV1(blocks: unknown[], language: 'sk' | 'en' = 'sk') {
  return renderCampaign({
    subject: 'Novinky',
    preheader: 'Skrytý riadok',
    // Stored v1 JSON, as read from `bulk_campaigns.blocks`, upgraded as the service does.
    blocks: upgradeBlocks(1, blocks),
    recipient: { name: 'Jana <Nováková>', language },
    unsubscribeHref: 'https://spolu.test/unsubscribe/u1.c1.sig',
    publicUrl: 'https://spolu.test/',
    imageSizes: SIZES,
  });
}

describe('content version 1 renders as before (snapshots of the Phase 23 renderer)', () => {
  it('every block type and option', () => {
    const { html, text } = renderV1(V1_BLOCKS);
    expect(html).toMatchSnapshot('html');
    expect(text).toMatchSnapshot('text');
  });

  it('a short email in English', () => {
    const { html, text } = renderV1(
      [
        { id: 'h', type: 'heading', text: 'Hello', align: 'left' },
        { id: 't', type: 'text', text: 'One **two** three', align: 'left' },
      ],
      'en',
    );
    expect(html).toMatchSnapshot('html');
    expect(text).toMatchSnapshot('text');
  });
});

/**
 * The wide split-container layout (spec 2026-10-17-bulk-email-builder-layout-design.md) must not
 * change a content version 2 email without a container. Recorded with the Phase 31 renderer
 * before the wide layout was added; never update it to make a failing test pass.
 */
describe('content version 2 without a split container renders as before the wide layout', () => {
  const V2_BLOCKS = [
    { id: 'l', type: 'logo', align: 'right' },
    {
      id: 't',
      type: 'text',
      align: 'left',
      content: [
        { type: 'h2', content: [{ text: 'Novinky, {{name}}' }] },
        {
          type: 'paragraph',
          align: 'center',
          content: [
            { text: 'Tučné', marks: ['bold', 'italic'] },
            { text: ' a ' },
            { text: 'odkaz', href: 'https://egrant.sk', color: 'purple' },
          ],
        },
        { type: 'bullet', content: [{ text: 'Jeden' }] },
        { type: 'bullet', content: [{ text: 'Dva', marks: ['strike'] }] },
      ],
    },
    {
      id: 'i',
      type: 'image',
      imageId: 'img-large',
      alt: 'Foto',
      align: 'right',
      width: { unit: 'percent', value: 50 },
      shape: 'rounded',
    },
    { id: 's', type: 'spacer', size: 'large' },
    { id: 'b', type: 'button', label: 'Otvoriť', url: 'https://egrant.sk', align: 'right' },
  ];

  it('one version, and a separate phone version', () => {
    const blocks = upgradeBlocks(2, V2_BLOCKS);
    const base = {
      subject: 'Novinky',
      preheader: 'Riadok',
      blocks,
      recipient: { name: 'Jana', language: 'sk' as const },
      unsubscribeHref: 'https://spolu.test/unsubscribe/u1.c1.sig',
      publicUrl: 'https://spolu.test',
      imageSizes: SIZES,
    };
    expect(renderCampaign(base).html).toMatchSnapshot('html');
    expect(renderCampaign({ ...base, phoneBlocks: blocks.slice(1) }).html).toMatchSnapshot(
      'html with phone version',
    );
  });
});
