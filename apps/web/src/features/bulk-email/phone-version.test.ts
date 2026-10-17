import { describe, expect, it } from 'vitest';
import type { BulkBlock } from '@spolu/shared';
import { newBlock } from './blocks';
import { applyEdit, returnToDesktop, shownBlocks, type Versions } from './phone-version';

const ids = (blocks: BulkBlock[]) => blocks.map((b) => b.id);
const start = (): Versions => ({
  blocks: [newBlock('heading', 'h'), newBlock('text', 't')],
  phoneBlocks: null,
});

describe('phone version inheritance', () => {
  it('follows desktop: desktop edits show in phone mode', () => {
    const v = applyEdit(start(), 'computer', { type: 'add', blockType: 'logo', id: 'l' });
    expect(v.phoneBlocks).toBeNull();
    expect(ids(shownBlocks(v, 'phone'))).toEqual(['h', 't', 'l']);
  });

  it('the first phone edit breaks inheritance: a copy of desktop plus the edit', () => {
    const before = start();
    const v = applyEdit(before, 'phone', { type: 'move', id: 't', by: -1 });
    expect(ids(v.phoneBlocks!)).toEqual(['t', 'h']);
    expect(ids(v.blocks)).toEqual(['h', 't']);
    expect(v.blocks).toBe(before.blocks);
  });

  it('a phone edit that changes nothing does not break inheritance', () => {
    const before = start();
    expect(applyEdit(before, 'phone', { type: 'move', id: 'h', by: -1 })).toBe(before);
    expect(applyEdit(before, 'phone', { type: 'remove', id: 'nope' })).toBe(before);
  });

  it('desktop edits after the break do not change the phone tree', () => {
    let v = applyEdit(start(), 'phone', { type: 'remove', id: 'h' });
    const phone = v.phoneBlocks;
    v = applyEdit(v, 'computer', { type: 'add', blockType: 'divider', id: 'd' });
    v = applyEdit(v, 'computer', {
      type: 'update',
      block: { id: 't', type: 'text', align: 'center', content: [] },
    });
    expect(v.phoneBlocks).toBe(phone);
    expect(ids(v.phoneBlocks!)).toEqual(['t']);
    expect(ids(v.blocks)).toEqual(['h', 't', 'd']);
  });

  it('phone edits after the break change only the phone tree', () => {
    let v = applyEdit(start(), 'phone', { type: 'remove', id: 'h' });
    const desktop = v.blocks;
    v = applyEdit(v, 'phone', { type: 'add', blockType: 'spacer', id: 's' });
    expect(ids(v.phoneBlocks!)).toEqual(['t', 's']);
    expect(v.blocks).toBe(desktop);
  });

  it('"Return to the computer version" drops the phone tree and follows desktop again', () => {
    let v = applyEdit(start(), 'phone', { type: 'remove', id: 'h' });
    v = returnToDesktop(v);
    expect(v.phoneBlocks).toBeNull();
    v = applyEdit(v, 'computer', { type: 'add', blockType: 'logo', id: 'l' });
    expect(ids(shownBlocks(v, 'phone'))).toEqual(['h', 't', 'l']);
  });
});
