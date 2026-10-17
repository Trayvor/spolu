import {
  BULK_LIMITS,
  countBlocks,
  type BulkBlock,
  type BulkBlockType,
  type BulkLeafBlock,
} from '@spolu/shared';

/** The block types, in the order "Add block" offers them. */
export const BulkBlockTypes = [
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'logo',
  'columns',
] as const satisfies readonly BulkBlockType[];

/** The types a split container's side takes: every one but the container (no nesting). */
export const BulkLeafBlockTypes = BulkBlockTypes.filter(
  (t): t is Exclude<(typeof BulkBlockTypes)[number], 'columns'> => t !== 'columns',
);

/** Where a block stands: the main list (`null`) or one side of a split container. */
export type Place = { container: string; side: 'left' | 'right' } | null;

/**
 * A new block with empty content. An image has no `imageId` and no `alt` until the admin uploads
 * one and describes it, and a button has no URL: such blocks are not valid yet, so the editor
 * keeps them local and saves once they are complete (see `validation.ts`).
 */
export function newBlock(type: BulkBlockType, id: string): BulkBlock {
  switch (type) {
    case 'heading':
      return { id, type, text: '', align: 'left' };
    case 'text':
      return { id, type, align: 'left', content: [] };
    case 'image':
      return { id, type, imageId: '', alt: '' };
    case 'button':
      return { id, type, label: '', url: '', align: 'left' };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, size: 'medium' };
    case 'logo':
      return { id, type, align: 'center' };
    case 'columns':
      return {
        id,
        type,
        ratio: '50-50',
        valign: 'top',
        divider: true,
        dividerColor: 'line',
        left: [],
        right: [],
      };
  }
}

export type BlocksAction =
  | { type: 'add'; blockType: BulkBlockType; id: string; place?: Place }
  | { type: 'update'; block: BulkBlock }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'remove'; id: string }
  | { type: 'place'; id: string; to: Place };

type Columns = Extract<BulkBlock, { type: 'columns' }>;

/** The place of block `id`, or undefined when it is nowhere. */
export function placeOf(blocks: readonly BulkBlock[], id: string): Place | undefined {
  if (blocks.some((b) => b.id === id)) return null;
  for (const b of blocks) {
    if (b.type !== 'columns') continue;
    if (b.left.some((x) => x.id === id)) return { container: b.id, side: 'left' };
    if (b.right.some((x) => x.id === id)) return { container: b.id, side: 'right' };
  }
  return undefined;
}

const samePlace = (a: Place | undefined, b: Place) =>
  a === b || (a != null && b != null && a.container === b.container && a.side === b.side);

/** Every place block `id` could move to but its own; none for a container. */
export function placesFor(blocks: readonly BulkBlock[], id: string): Place[] {
  const here = placeOf(blocks, id);
  const block = findBlock(blocks, id);
  if (here === undefined || !block || block.type === 'columns') return [];
  const all: Place[] = [
    null,
    ...blocks.flatMap((b) =>
      b.type === 'columns'
        ? [
            { container: b.id, side: 'left' as const },
            { container: b.id, side: 'right' as const },
          ]
        : [],
    ),
  ];
  return all.filter((p) => !samePlace(here, p));
}

export function findBlock(blocks: readonly BulkBlock[], id: string): BulkBlock | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'columns') {
      const inner = b.left.find((x) => x.id === id) ?? b.right.find((x) => x.id === id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Applies `edit` to the list at `place`; answers `blocks` itself when nothing changed. */
function editList(
  blocks: BulkBlock[],
  place: Place,
  edit: (list: BulkBlock[]) => BulkBlock[],
): BulkBlock[] {
  if (place === null) return edit(blocks);
  let changed = false;
  const next = blocks.map((b) => {
    if (b.id !== place.container || b.type !== 'columns') return b;
    const list = b[place.side];
    const edited = edit(list);
    if (edited === list) return b;
    changed = true;
    return { ...b, [place.side]: edited as BulkLeafBlock[] } as Columns;
  });
  return changed ? next : blocks;
}

function move(list: BulkBlock[], id: string, by: -1 | 1): BulkBlock[] {
  const from = list.findIndex((b) => b.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** The block list's edits, also inside containers. An edit that changes nothing answers the same array. */
export function blocksReducer(blocks: BulkBlock[], action: BlocksAction): BulkBlock[] {
  switch (action.type) {
    case 'add': {
      if (countBlocks(blocks) >= BULK_LIMITS.blocks) return blocks;
      const place = action.place ?? null;
      if (place !== null && action.blockType === 'columns') return blocks;
      return editList(blocks, place, (list) => [...list, newBlock(action.blockType, action.id)]);
    }
    case 'update':
      return blocks.map((b) => {
        if (b.id === action.block.id) return action.block;
        if (b.type !== 'columns' || action.block.type === 'columns') return b;
        const swap = (list: BulkLeafBlock[]) =>
          list.map((x) => (x.id === action.block.id ? (action.block as BulkLeafBlock) : x));
        if (![...b.left, ...b.right].some((x) => x.id === action.block.id)) return b;
        return { ...b, left: swap(b.left), right: swap(b.right) };
      });
    case 'move': {
      const place = placeOf(blocks, action.id);
      if (place === undefined) return blocks;
      return editList(blocks, place, (list) => move(list, action.id, action.by));
    }
    case 'remove': {
      const place = placeOf(blocks, action.id);
      if (place === undefined) return blocks;
      return editList(blocks, place, (list) => list.filter((b) => b.id !== action.id));
    }
    case 'place': {
      const from = placeOf(blocks, action.id);
      const block = findBlock(blocks, action.id);
      if (from === undefined || !block || samePlace(from, action.to)) return blocks;
      if (block.type === 'columns' && action.to !== null) return blocks;
      if (action.to !== null) {
        const target = action.to.container;
        if (!blocks.some((b) => b.id === target && b.type === 'columns')) return blocks;
      }
      const without = editList(blocks, from, (list) => list.filter((b) => b.id !== action.id));
      if (action.to === null) {
        // Out of a container: right after that container.
        const at = without.findIndex((b) => b.id === from?.container) + 1;
        return [...without.slice(0, at), block, ...without.slice(at)];
      }
      return editList(without, action.to, (list) => [...list, block]);
    }
  }
}
