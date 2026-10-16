import { useTranslation } from 'react-i18next';
import { BULK_LIMITS, type BulkBlock, type BulkNotReadyProblem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icons';
import { BlockForm } from './block-forms';
import { BulkBlockTypes, type BlocksAction } from './blocks';
import type { FieldProblem } from './validation';

const UpIcon = () => (
  <Icon>
    <path d="m6 15 6-6 6 6" />
  </Icon>
);
const DownIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

/**
 * The email's blocks in order, each with its form and Move up / Move down / Delete (buttons,
 * not drag and drop: the same on a phone and with a keyboard), then "Add block" with the six
 * types. `serverProblems`: the `not_ready` reasons of the last test send, shown at their block.
 */
export function BlockList({
  blocks,
  problems,
  serverProblems,
  dispatch,
}: {
  blocks: BulkBlock[];
  problems: Record<string, Record<string, FieldProblem>>;
  serverProblems: BulkNotReadyProblem[];
  dispatch: (action: BlocksAction) => void;
}) {
  const { t } = useTranslation();
  const full = blocks.length >= BULK_LIMITS.blocks;

  return (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-border px-5 py-6 text-button text-muted-foreground">
          {t('bulkEmail.blocks.empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={t('bulkEmail.blocks.title')}>
          {blocks.map((block, index) => {
            const n = index + 1;
            const type = t(`bulkEmail.blocks.types.${block.type}`);
            const notReady = serverProblems.filter((p) => p.blockId === block.id);
            return (
              <li
                key={block.id}
                data-testid={`block-${block.id}`}
                className="flex flex-col gap-4 rounded-xl border-2 border-border bg-card p-4 aria-invalid:border-destructive"
                aria-invalid={notReady.length > 0 || problems[block.id] ? true : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-semibold">
                    {n}
                  </span>
                  <h3 className="min-w-0 flex-1 truncate text-button font-semibold">{type}</h3>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('bulkEmail.blocks.moveUp', { n, type })}
                      onClick={() => dispatch({ type: 'move', id: block.id, by: -1 })}
                    >
                      <UpIcon />
                    </Button>
                  )}
                  {index < blocks.length - 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('bulkEmail.blocks.moveDown', { n, type })}
                      onClick={() => dispatch({ type: 'move', id: block.id, by: 1 })}
                    >
                      <DownIcon />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('bulkEmail.blocks.delete', { n, type })}
                    onClick={() => dispatch({ type: 'remove', id: block.id })}
                  >
                    <TrashIcon />
                  </Button>
                </div>
                <BlockForm
                  block={block}
                  problems={problems[block.id]}
                  onChange={(next) => dispatch({ type: 'update', block: next })}
                />
                {notReady.map((p) => (
                  <p key={p.problem} role="alert" className="text-micro text-error-ink">
                    {t(`bulkEmail.notReady.${p.problem}`)}
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-tiny font-semibold" id="add-block-label">
          {t('bulkEmail.blocks.add')}
        </span>
        <div role="group" aria-labelledby="add-block-label" className="flex flex-wrap gap-2">
          {BulkBlockTypes.map((type) => (
            <Button
              key={type}
              type="button"
              variant="secondary"
              size="sm"
              disabled={full}
              onClick={() => dispatch({ type: 'add', blockType: type, id: crypto.randomUUID() })}
            >
              {t(`bulkEmail.blocks.types.${type}`)}
            </Button>
          ))}
        </div>
        {full && (
          <p className="text-micro text-muted-foreground">
            {t('bulkEmail.blocks.limit', { max: BULK_LIMITS.blocks })}
          </p>
        )}
      </div>
    </div>
  );
}
