import type { BulkBlock } from '@spolu/shared';
import { blocksReducer, type BlocksAction } from './blocks';

/**
 * The phone version (Phase 30, spec §4). `phoneBlocks: null` = the phone version follows the
 * desktop one: it shows and sends the desktop blocks. The first edit made in Phone mode copies
 * the desktop blocks as they are at that moment and applies the edit to the copy; from then on
 * the two versions are separate trees, until "Return to the computer version".
 */

export type EditMode = 'computer' | 'phone';

export type Versions = { blocks: BulkBlock[]; phoneBlocks: BulkBlock[] | null };

/** The blocks the editor shows (and edits) in `mode`. */
export function shownBlocks(v: Versions, mode: EditMode): BulkBlock[] {
  return mode === 'phone' ? (v.phoneBlocks ?? v.blocks) : v.blocks;
}

/** Applies an edit in `mode`. An edit that changes nothing answers `v` itself (no copy made). */
export function applyEdit<V extends Versions>(v: V, mode: EditMode, action: BlocksAction): V {
  if (mode === 'computer') {
    const blocks = blocksReducer(v.blocks, action);
    return blocks === v.blocks ? v : { ...v, blocks };
  }
  const base = v.phoneBlocks ?? v.blocks;
  const phoneBlocks = blocksReducer(base, action);
  // The reducer never changes `base`, so desktop is untouched when the copy starts.
  return phoneBlocks === base ? v : { ...v, phoneBlocks };
}

/** Drops the phone version: it follows the desktop version again. */
export function returnToDesktop<V extends Versions>(v: V): V {
  return v.phoneBlocks === null ? v : { ...v, phoneBlocks: null };
}
