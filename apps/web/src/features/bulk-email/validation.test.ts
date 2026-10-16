import { describe, expect, it } from 'vitest';
import type { BulkBlock } from '@spolu/shared';
import { draftProblems, hasProblems, validBlocks, type EditableDraft } from './validation';

const EMPTY_AUDIENCE = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};

function draft(blocks: BulkBlock[], extra: Partial<EditableDraft> = {}): EditableDraft {
  return {
    name: 'News',
    subject: 'Hello',
    preheader: '',
    blocks,
    audience: EMPTY_AUDIENCE,
    ...extra,
  };
}

describe('draftProblems', () => {
  it('finds nothing in a valid draft', () => {
    const p = draftProblems(
      draft([
        { id: 'h', type: 'heading', text: 'Hi {{name}}', align: 'left' },
        { id: 'b', type: 'button', label: 'Open', url: 'https://egrant.sk', align: 'center' },
        { id: 'm', type: 'button', label: 'Write', url: 'mailto:info@egrant.sk', align: 'left' },
        { id: 'i', type: 'image', imageId: 'img', alt: 'Team', href: 'https://egrant.sk' },
      ]),
    );
    expect(hasProblems(p)).toBe(false);
  });

  it('needs a name and keeps fields within their limits', () => {
    const p = draftProblems(draft([], { name: '  ', subject: 'x'.repeat(201) }));
    expect(p.name).toBe('required');
    expect(p.subject).toBe('tooLong');
    expect(hasProblems(p)).toBe(true);
  });

  it('marks a too long heading and text at their block', () => {
    const p = draftProblems(
      draft([
        { id: 'h', type: 'heading', text: 'x'.repeat(201), align: 'left' },
        { id: 't', type: 'text', text: 'x'.repeat(5001), align: 'left' },
      ]),
    );
    expect(p.blocks).toEqual({ h: { text: 'tooLong' }, t: { text: 'tooLong' } });
  });

  it('needs an uploaded image and its alt text', () => {
    const p = draftProblems(draft([{ id: 'i', type: 'image', imageId: '', alt: ' ' }]));
    expect(p.blocks.i).toEqual({ imageId: 'required', alt: 'required' });
  });

  it('rejects a javascript: button URL and a missing one', () => {
    const p = draftProblems(
      draft([
        { id: 'a', type: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' },
        { id: 'b', type: 'button', label: 'Go', url: '', align: 'left' },
      ]),
    );
    expect(p.blocks).toEqual({ a: { url: 'invalidUrl' }, b: { url: 'required' } });
  });

  it('rejects an image link that is not http(s)', () => {
    const p = draftProblems(
      draft([{ id: 'i', type: 'image', imageId: 'img', alt: 'A', href: 'mailto:x@y.sk' }]),
    );
    expect(p.blocks.i).toEqual({ href: 'invalidUrl' });
  });
});

describe('validBlocks', () => {
  it('keeps only the blocks the server accepts', () => {
    const ok: BulkBlock = { id: 'd', type: 'divider' };
    expect(validBlocks([ok, { id: 'i', type: 'image', imageId: '', alt: '' }])).toEqual([ok]);
  });
});
