import { describe, expect, it } from 'vitest';
import { BULK_LIMITS, type BulkBlock } from '@spolu/shared';
import { BulkBlockTypes, blocksReducer, newBlock } from './blocks';

const ids = (blocks: BulkBlock[]) => blocks.map((b) => b.id);

describe('newBlock', () => {
  it('makes each of the six types with empty content', () => {
    expect(BulkBlockTypes).toEqual(['heading', 'text', 'image', 'button', 'divider', 'logo']);
    expect(newBlock('heading', 'a')).toEqual({ id: 'a', type: 'heading', text: '', align: 'left' });
    expect(newBlock('text', 'a')).toEqual({ id: 'a', type: 'text', text: '', align: 'left' });
    expect(newBlock('image', 'a')).toEqual({ id: 'a', type: 'image', imageId: '', alt: '' });
    expect(newBlock('button', 'a')).toEqual({
      id: 'a',
      type: 'button',
      label: '',
      url: '',
      align: 'left',
    });
    expect(newBlock('divider', 'a')).toEqual({ id: 'a', type: 'divider' });
    expect(newBlock('logo', 'a')).toEqual({ id: 'a', type: 'logo', align: 'center' });
  });
});

describe('blocksReducer', () => {
  const three = [newBlock('heading', 'h'), newBlock('text', 't'), newBlock('divider', 'd')];

  it('adds a block at the end', () => {
    const next = blocksReducer(three, { type: 'add', blockType: 'logo', id: 'l' });
    expect(ids(next)).toEqual(['h', 't', 'd', 'l']);
  });

  it('adds nothing past the block limit', () => {
    const full = Array.from({ length: BULK_LIMITS.blocks }, (_, i) => newBlock('divider', `b${i}`));
    expect(blocksReducer(full, { type: 'add', blockType: 'text', id: 'x' })).toBe(full);
  });

  it('moves a block up and down', () => {
    expect(ids(blocksReducer(three, { type: 'move', id: 't', by: -1 }))).toEqual(['t', 'h', 'd']);
    expect(ids(blocksReducer(three, { type: 'move', id: 't', by: 1 }))).toEqual(['h', 'd', 't']);
  });

  it('leaves the list as it is when a move would leave it', () => {
    expect(blocksReducer(three, { type: 'move', id: 'h', by: -1 })).toBe(three);
    expect(blocksReducer(three, { type: 'move', id: 'd', by: 1 })).toBe(three);
    expect(blocksReducer(three, { type: 'move', id: 'nope', by: 1 })).toBe(three);
  });

  it('replaces a block by id', () => {
    const next = blocksReducer(three, {
      type: 'update',
      block: { id: 't', type: 'text', text: 'Hi', align: 'center' },
    });
    expect(next[1]).toEqual({ id: 't', type: 'text', text: 'Hi', align: 'center' });
    expect(next[0]).toBe(three[0]);
  });

  it('removes a block', () => {
    expect(ids(blocksReducer(three, { type: 'remove', id: 'h' }))).toEqual(['t', 'd']);
  });
});
