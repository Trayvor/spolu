import { BULK_LIMITS, type BulkBlock, type BulkBlockType } from '@spolu/shared';

/** The six block types, in the order "Add block" offers them. */
export const BulkBlockTypes = [
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'logo',
] as const satisfies readonly BulkBlockType[];

/**
 * A new block with empty content. An image has no `imageId` and no `alt` until the admin uploads
 * one and describes it, and a button has no URL: such blocks are not valid yet, so the editor
 * keeps them local and saves once they are complete (see `validation.ts`).
 */
export function newBlock(type: BulkBlockType, id: string): BulkBlock {
  switch (type) {
    case 'heading':
    case 'text':
      return { id, type, text: '', align: 'left' };
    case 'image':
      return { id, type, imageId: '', alt: '' };
    case 'button':
      return { id, type, label: '', url: '', align: 'left' };
    case 'divider':
      return { id, type };
    case 'logo':
      return { id, type, align: 'center' };
  }
}

export type BlocksAction =
  | { type: 'add'; blockType: BulkBlockType; id: string }
  | { type: 'update'; block: BulkBlock }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'remove'; id: string };

/** The block list's edits. An edit that changes nothing answers the same array. */
export function blocksReducer(blocks: BulkBlock[], action: BlocksAction): BulkBlock[] {
  switch (action.type) {
    case 'add':
      if (blocks.length >= BULK_LIMITS.blocks) return blocks;
      return [...blocks, newBlock(action.blockType, action.id)];
    case 'update':
      return blocks.map((b) => (b.id === action.block.id ? action.block : b));
    case 'move': {
      const from = blocks.findIndex((b) => b.id === action.id);
      const to = from + action.by;
      if (from < 0 || to < 0 || to >= blocks.length) return blocks;
      const next = [...blocks];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    }
    case 'remove':
      return blocks.filter((b) => b.id !== action.id);
  }
}
