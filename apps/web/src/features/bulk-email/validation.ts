import { BULK_LIMITS, BulkBlockSchema, type BulkAudience, type BulkBlock } from '@spolu/shared';

/** What the editor holds and saves: the draft without its `version`. */
export type EditableDraft = {
  name: string;
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  audience: BulkAudience;
};

export type FieldProblem = 'required' | 'tooLong' | 'invalidUrl';

/** Problems per field; `blocks` maps a block id to its fields' problems. */
export type DraftProblems = {
  name?: FieldProblem;
  subject?: FieldProblem;
  preheader?: FieldProblem;
  blocks: Record<string, Record<string, FieldProblem>>;
};

function textProblem(value: string, max: number, required = false): FieldProblem | undefined {
  if (required && !value.trim()) return 'required';
  return value.trim().length > max ? 'tooLong' : undefined;
}

/** Why one block would be refused by the server (the shared `BulkBlockSchema`), per field. */
function blockProblems(block: BulkBlock): Record<string, FieldProblem> | undefined {
  const parsed = BulkBlockSchema.safeParse(block);
  if (parsed.success) return undefined;
  const fields: Record<string, FieldProblem> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'block');
    if (fields[field]) continue;
    const value = (block as Record<string, unknown>)[field];
    if (typeof value === 'string' && !value.trim()) fields[field] = 'required';
    else if (issue.code === 'too_big') fields[field] = 'tooLong';
    else fields[field] = 'invalidUrl';
  }
  return fields;
}

/**
 * Client-side mirror of the save route's checks (`BulkCampaignDraftSchema`), so the editor can
 * show each problem at its field and never sends a draft the server would refuse.
 */
export function draftProblems(draft: EditableDraft): DraftProblems {
  const problems: DraftProblems = { blocks: {} };
  const name = textProblem(draft.name, BULK_LIMITS.name, true);
  const subject = textProblem(draft.subject, BULK_LIMITS.subject);
  const preheader = textProblem(draft.preheader, BULK_LIMITS.preheader);
  if (name) problems.name = name;
  if (subject) problems.subject = subject;
  if (preheader) problems.preheader = preheader;
  for (const block of draft.blocks) {
    const found = blockProblems(block);
    if (found) problems.blocks[block.id] = found;
  }
  return problems;
}

export function hasProblems(problems: DraftProblems): boolean {
  return (
    problems.name !== undefined ||
    problems.subject !== undefined ||
    problems.preheader !== undefined ||
    Object.keys(problems.blocks).length > 0
  );
}

/** The blocks the server accepts; the preview shows these while others are being filled in. */
export function validBlocks(blocks: BulkBlock[]): BulkBlock[] {
  return blocks.filter((b) => BulkBlockSchema.safeParse(b).success);
}
