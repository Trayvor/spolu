import {
  BULK_LIMITS,
  BulkBlockSchema,
  flattenBlocks,
  type BulkAudience,
  type BulkBlock,
  type BulkLeafBlock,
} from '@spolu/shared';

/** What the editor holds and saves: the draft without its `version`. */
export type EditableDraft = {
  name: string;
  subject: string;
  preheader: string;
  /** The desktop version. */
  blocks: BulkBlock[];
  /** The phone version; `null` while it follows the desktop version (Phase 31). */
  phoneBlocks: BulkBlock[] | null;
  audience: BulkAudience;
};

export type FieldProblem = 'required' | 'tooLong' | 'invalidUrl';
export type BlockProblems = Record<string, Record<string, FieldProblem>>;

/** Problems per field; `blocks` / `phoneBlocks` map a block id to its fields' problems. */
export type DraftProblems = {
  name?: FieldProblem;
  subject?: FieldProblem;
  preheader?: FieldProblem;
  blocks: BlockProblems;
  phoneBlocks: BlockProblems;
};

function textProblem(value: string, max: number, required = false): FieldProblem | undefined {
  if (required && !value.trim()) return 'required';
  return value.trim().length > max ? 'tooLong' : undefined;
}

/** A container is checked without its blocks: each of them is checked on its own. */
const ownFields = (block: BulkBlock): BulkBlock =>
  block.type === 'columns' ? { ...block, left: [], right: [] } : block;

/** Why one block would be refused by the server (the shared `BulkBlockSchema`), per field. */
function blockProblems(block: BulkBlock): Record<string, FieldProblem> | undefined {
  const parsed = BulkBlockSchema.safeParse(ownFields(block));
  if (parsed.success) return undefined;
  const fields: Record<string, FieldProblem> = {};
  for (const issue of parsed.error.issues) {
    // A text's tree is one field, "text", as the form shows it.
    const path = String(issue.path[0] ?? 'block');
    const field = path === 'content' ? 'text' : path;
    if (fields[field]) continue;
    const value = (block as Record<string, unknown>)[field];
    if (typeof value === 'string' && !value.trim()) fields[field] = 'required';
    else if (issue.code === 'too_big' || (field === 'text' && issue.code === 'custom')) {
      fields[field] = 'tooLong';
    } else fields[field] = 'invalidUrl';
  }
  return fields;
}

function versionProblems(blocks: readonly BulkBlock[]): BlockProblems {
  const out: BlockProblems = {};
  for (const block of flattenBlocks(blocks)) {
    const found = blockProblems(block);
    if (found) out[block.id] = found;
  }
  return out;
}

/**
 * Client-side mirror of the save route's checks (`BulkCampaignDraftSchema`), so the editor can
 * show each problem at its field and never sends a draft the server would refuse.
 */
export function draftProblems(draft: EditableDraft): DraftProblems {
  const problems: DraftProblems = {
    blocks: versionProblems(draft.blocks),
    phoneBlocks: versionProblems(draft.phoneBlocks ?? []),
  };
  const name = textProblem(draft.name, BULK_LIMITS.name, true);
  const subject = textProblem(draft.subject, BULK_LIMITS.subject);
  const preheader = textProblem(draft.preheader, BULK_LIMITS.preheader);
  if (name) problems.name = name;
  if (subject) problems.subject = subject;
  if (preheader) problems.preheader = preheader;
  return problems;
}

export function hasProblems(problems: DraftProblems): boolean {
  return (
    problems.name !== undefined ||
    problems.subject !== undefined ||
    problems.preheader !== undefined ||
    Object.keys(problems.blocks).length > 0 ||
    Object.keys(problems.phoneBlocks).length > 0
  );
}

const valid = (b: BulkBlock) => BulkBlockSchema.safeParse(ownFields(b)).success;

/**
 * The blocks the server accepts; the preview shows these while others are being filled in. A
 * container keeps only its valid blocks.
 */
export function validBlocks(blocks: BulkBlock[]): BulkBlock[] {
  return blocks.filter(valid).map((b) =>
    b.type === 'columns'
      ? {
          ...b,
          left: b.left.filter(valid) as BulkLeafBlock[],
          right: b.right.filter(valid) as BulkLeafBlock[],
        }
      : b,
  );
}
