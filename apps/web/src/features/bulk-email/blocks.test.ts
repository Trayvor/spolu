import { describe, expect, it } from 'vitest';
import { BULK_LIMITS, type BulkBlock, type BulkLeafBlock } from '@spolu/shared';
import { BulkBlockTypes, blocksReducer, newBlock, placesFor, withMode } from './blocks';

const ids = (blocks: BulkBlock[]) => blocks.map((b) => b.id);
const columnsOf = (blocks: BulkBlock[], id = 'c') =>
  blocks.find((b) => b.id === id) as Extract<BulkBlock, { type: 'columns' }>;

describe('newBlock', () => {
  it('makes each type with empty content', () => {
    expect(BulkBlockTypes).toEqual([
      'heading',
      'text',
      'image',
      'button',
      'divider',
      'spacer',
      'logo',
      'columns',
    ]);
    expect(newBlock('heading', 'a')).toEqual({ id: 'a', type: 'heading', text: '', align: 'left' });
    expect(newBlock('text', 'a')).toEqual({ id: 'a', type: 'text', align: 'left', content: [] });
    expect(newBlock('image', 'a')).toEqual({ id: 'a', type: 'image', imageId: '', alt: '' });
    expect(newBlock('button', 'a')).toEqual({
      id: 'a',
      type: 'button',
      label: '',
      url: '',
      align: 'left',
    });
    expect(newBlock('divider', 'a')).toEqual({ id: 'a', type: 'divider' });
    expect(newBlock('spacer', 'a')).toEqual({ id: 'a', type: 'spacer', size: 'medium' });
    expect(newBlock('logo', 'a')).toEqual({ id: 'a', type: 'logo', align: 'center' });
    expect(newBlock('columns', 'a')).toEqual({
      id: 'a',
      type: 'columns',
      mode: 'plain',
      ratio: '50-50',
      valign: 'top',
      divider: true,
      dividerColor: 'line',
      left: [],
      right: [],
    });
  });
});

describe('blocksReducer', () => {
  const three = [newBlock('heading', 'h'), newBlock('text', 't'), newBlock('divider', 'd')];

  it('adds a block at the end', () => {
    const next = blocksReducer(three, { type: 'add', blockType: 'logo', id: 'l' });
    expect(ids(next)).toEqual(['h', 't', 'd', 'l']);
  });

  it('adds nothing past the block limit, counting blocks inside containers', () => {
    const full = Array.from({ length: BULK_LIMITS.blocks }, (_, i) => newBlock('divider', `b${i}`));
    expect(blocksReducer(full, { type: 'add', blockType: 'text', id: 'x' })).toBe(full);
    const box = { ...newBlock('columns', 'c'), left: full.slice(0, 49) } as BulkBlock;
    expect(
      blocksReducer([box], {
        type: 'add',
        blockType: 'text',
        id: 'x',
        place: { container: 'c', side: 'right' },
      }),
    ).toEqual([box]);
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
    const block: BulkBlock = { id: 't', type: 'text', align: 'center', content: [] };
    const next = blocksReducer(three, { type: 'update', block });
    expect(next[1]).toEqual(block);
    expect(next[0]).toBe(three[0]);
  });

  it('removes a block', () => {
    expect(ids(blocksReducer(three, { type: 'remove', id: 'h' }))).toEqual(['t', 'd']);
  });

  describe('split containers', () => {
    const start = [...three, { ...newBlock('columns', 'c'), mode: 'split' } as BulkBlock];

    it('adds into a side, updates, moves and removes there', () => {
      let next = blocksReducer(start, {
        type: 'add',
        blockType: 'text',
        id: 'x',
        place: { container: 'c', side: 'left' },
      });
      next = blocksReducer(next, {
        type: 'add',
        blockType: 'button',
        id: 'y',
        place: { container: 'c', side: 'left' },
      });
      expect(ids(columnsOf(next).left)).toEqual(['x', 'y']);
      next = blocksReducer(next, { type: 'move', id: 'y', by: -1 });
      expect(ids(columnsOf(next).left)).toEqual(['y', 'x']);
      const edited: BulkBlock = { id: 'x', type: 'text', align: 'right', content: [] };
      next = blocksReducer(next, { type: 'update', block: edited });
      expect(columnsOf(next).left[1]).toEqual(edited);
      next = blocksReducer(next, { type: 'remove', id: 'y' });
      expect(ids(columnsOf(next).left)).toEqual(['x']);
    });

    it('a container is never added into a container', () => {
      const next = blocksReducer(start, {
        type: 'add',
        blockType: 'columns',
        id: 'z',
        place: { container: 'c', side: 'left' },
      });
      expect(next).toBe(start);
    });

    it('places an existing block into a side, to the other side and back out', () => {
      let next = blocksReducer(start, {
        type: 'place',
        id: 't',
        to: { container: 'c', side: 'left' },
      });
      expect(ids(next)).toEqual(['h', 'd', 'c']);
      expect(ids(columnsOf(next).left)).toEqual(['t']);
      next = blocksReducer(next, { type: 'place', id: 't', to: { container: 'c', side: 'right' } });
      expect(ids(columnsOf(next).left)).toEqual([]);
      expect(ids(columnsOf(next).right)).toEqual(['t']);
      next = blocksReducer(next, { type: 'place', id: 't', to: null });
      // Out of a container: right after it.
      expect(ids(next)).toEqual(['h', 'd', 'c', 't']);
    });

    it('never places a container into a container, nor a block where it already is', () => {
      const two = [...start, newBlock('columns', 'c2')];
      expect(
        blocksReducer(two, { type: 'place', id: 'c2', to: { container: 'c', side: 'left' } }),
      ).toBe(two);
      expect(blocksReducer(start, { type: 'place', id: 'h', to: null })).toBe(start);
    });

    it('placesFor lists the other places a block can go', () => {
      const placed = blocksReducer(start, {
        type: 'place',
        id: 't',
        to: { container: 'c', side: 'left' },
      });
      expect(placesFor(placed, 'h')).toEqual([
        { container: 'c', side: 'left' },
        { container: 'c', side: 'right' },
      ]);
      expect(placesFor(placed, 't')).toEqual([null, { container: 'c', side: 'right' }]);
      expect(placesFor(placed, 'c')).toEqual([]);
    });
  });

  describe('plain containers and switching modes', () => {
    const plain = newBlock('columns', 'c') as Extract<BulkBlock, { type: 'columns' }>;
    const t1 = newBlock('text', 'x') as BulkLeafBlock;
    const t2 = newBlock('divider', 'y') as BulkLeafBlock;

    it('a plain container offers one place, its area', () => {
      expect(placesFor([...three, plain], 'h')).toEqual([{ container: 'c', side: 'left' }]);
    });

    it('to plain: the right column follows the left one in the area; to split: the area is left', () => {
      const split = { ...plain, mode: 'split' as const, left: [t1], right: [t2] };
      const merged = withMode(split, 'plain');
      expect(merged).toMatchObject({ mode: 'plain', left: [t1, t2], right: [] });
      expect(withMode(merged, 'split')).toMatchObject({ mode: 'split', left: [t1, t2], right: [] });
      expect(withMode(merged, 'plain')).toBe(merged);
    });

    it('a container stored without a mode is split', () => {
      const old = { ...plain, left: [t1], right: [t2] };
      delete old.mode;
      expect(withMode(old, 'split')).toBe(old);
      expect(placesFor([old, newBlock('heading', 'z')], 'z')).toEqual([
        { container: 'c', side: 'left' },
        { container: 'c', side: 'right' },
      ]);
    });
  });
});
