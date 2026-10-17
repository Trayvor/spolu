import { describe, expect, it } from 'vitest';
import {
  BULK_LIMITS,
  BulkAudienceSchema,
  BulkBlockSchema,
  BulkCampaignDraftSchema,
} from './bulk-email.js';

const button = (url: string) => ({ id: 'b1', type: 'button', label: 'Open', url, align: 'left' });
const draft = (blocks: unknown[]) => ({
  name: 'News',
  subject: 'Hello',
  preheader: '',
  blocks,
  audience: {},
  version: 1,
});

describe('BulkBlockSchema', () => {
  it('a button with javascript: URL is rejected', () => {
    expect(BulkBlockSchema.safeParse(button('javascript:alert(1)')).success).toBe(false);
    expect(BulkBlockSchema.safeParse(button('JavaScript:alert(1)')).success).toBe(false);
  });

  it('a button accepts http(s) and mailto:', () => {
    expect(BulkBlockSchema.safeParse(button('https://egrant.sk/a?b=1')).success).toBe(true);
    expect(BulkBlockSchema.safeParse(button('mailto:info@egrant.sk')).success).toBe(true);
  });

  it('a button rejects a relative URL and a data: URL', () => {
    expect(BulkBlockSchema.safeParse(button('/groups')).success).toBe(false);
    expect(BulkBlockSchema.safeParse(button('data:text/html,x')).success).toBe(false);
  });

  it('an image without alt is rejected', () => {
    const image = { id: 'i1', type: 'image', imageId: 'img', alt: '' };
    expect(BulkBlockSchema.safeParse(image).success).toBe(false);
    expect(BulkBlockSchema.safeParse({ ...image, alt: 'Logo' }).success).toBe(true);
  });

  it('an image href must be http(s)', () => {
    const image = { id: 'i1', type: 'image', imageId: 'img', alt: 'A' };
    expect(BulkBlockSchema.safeParse({ ...image, href: 'javascript:x' }).success).toBe(false);
    expect(BulkBlockSchema.safeParse({ ...image, href: 'https://egrant.sk' }).success).toBe(true);
  });

  it('a text of 5 001 characters is rejected, also split over nodes and runs', () => {
    const text = (...runs: string[]) => ({
      id: 't1',
      type: 'text',
      align: 'left',
      content: runs.map((r) => ({ type: 'paragraph', content: [{ text: r }] })),
    });
    expect(BulkBlockSchema.safeParse(text('a'.repeat(5000))).success).toBe(true);
    expect(BulkBlockSchema.safeParse(text('a'.repeat(5001))).success).toBe(false);
    expect(BulkBlockSchema.safeParse(text('a'.repeat(2500), 'a'.repeat(2501))).success).toBe(false);
  });

  it('a heading over 200 and a button label over 60 are rejected', () => {
    const heading = { id: 'h1', type: 'heading', text: 'a'.repeat(201), align: 'center' };
    expect(BulkBlockSchema.safeParse(heading).success).toBe(false);
    const long = { ...button('https://egrant.sk'), label: 'a'.repeat(61) };
    expect(BulkBlockSchema.safeParse(long).success).toBe(false);
  });

  it('accepts a divider and a logo', () => {
    expect(BulkBlockSchema.safeParse({ id: 'd', type: 'divider' }).success).toBe(true);
    expect(BulkBlockSchema.safeParse({ id: 'l', type: 'logo', align: 'center' }).success).toBe(
      true,
    );
  });

  it('an unknown block type is rejected', () => {
    expect(BulkBlockSchema.safeParse({ id: 'x', type: 'html', html: '<b>' }).success).toBe(false);
  });

  it('an unknown align is rejected; right is allowed', () => {
    const block = { id: 't1', type: 'text', content: [], align: 'justify' };
    expect(BulkBlockSchema.safeParse(block).success).toBe(false);
    expect(BulkBlockSchema.safeParse({ ...block, align: 'right' }).success).toBe(true);
  });
});

describe('BulkAudienceSchema', () => {
  it('audience lists default to []', () => {
    expect(BulkAudienceSchema.parse({})).toEqual({
      groupIds: [],
      managerIds: [],
      roles: [],
      includeUserIds: [],
      excludeUserIds: [],
    });
  });

  it('an audience list of 501 ids is rejected', () => {
    const ids = Array.from({ length: BULK_LIMITS.audienceIds + 1 }, (_, i) => `u${i}`);
    expect(BulkAudienceSchema.safeParse({ includeUserIds: ids }).success).toBe(false);
    expect(BulkAudienceSchema.safeParse({ groupIds: ids.slice(1) }).success).toBe(true);
  });

  it('an unknown role is rejected', () => {
    expect(BulkAudienceSchema.safeParse({ roles: ['superadmin'] }).success).toBe(false);
  });
});

describe('BulkCampaignDraftSchema', () => {
  it('51 blocks are rejected', () => {
    const blocks = Array.from({ length: 51 }, (_, i) => ({ id: `d${i}`, type: 'divider' }));
    expect(BulkCampaignDraftSchema.safeParse(draft(blocks.slice(1))).success).toBe(true);
    expect(BulkCampaignDraftSchema.safeParse(draft(blocks)).success).toBe(false);
  });

  it('a subject over 200 characters is rejected', () => {
    const value = { ...draft([]), subject: 'a'.repeat(201) };
    expect(BulkCampaignDraftSchema.safeParse(value).success).toBe(false);
  });

  it('an empty subject is allowed in a draft', () => {
    const value = { ...draft([]), subject: '' };
    expect(BulkCampaignDraftSchema.safeParse(value).success).toBe(true);
  });

  it('a blank name is rejected', () => {
    expect(BulkCampaignDraftSchema.safeParse({ ...draft([]), name: '  ' }).success).toBe(false);
  });
});
