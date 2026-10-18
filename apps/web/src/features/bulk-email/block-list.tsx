import { useTranslation } from 'react-i18next';
import {
  BULK_LIMITS,
  countBlocks,
  type BulkBlock,
  type BulkBlockType,
  type BulkNotReadyProblem,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icons';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BlockForm } from './block-forms';
import {
  BulkBlockTypes,
  BulkLeafBlockTypes,
  placesFor,
  type BlocksAction,
  type Place,
} from './blocks';
import type { BlockProblems } from './validation';

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

type ListProps = {
  /** The whole version: places and numbers are found in it. */
  root: BulkBlock[];
  problems: BlockProblems;
  serverProblems: BulkNotReadyProblem[];
  dispatch: (action: BlocksAction) => void;
};

const placeKey = (p: Place) => (p === null ? 'main' : `${p.container}:${p.side}`);

/** "Add block" for the main list or one side of a container (no container there). */
function AddBlock({
  place,
  full,
  dispatch,
  labelId,
  label,
}: {
  place: Place;
  full: boolean;
  dispatch: (action: BlocksAction) => void;
  labelId: string;
  label: string;
}) {
  const { t } = useTranslation();
  const types: readonly BulkBlockType[] = place === null ? BulkBlockTypes : BulkLeafBlockTypes;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-tiny font-semibold" id={labelId}>
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {types.map((type) => (
          <Button
            key={type}
            type="button"
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() =>
              dispatch({ type: 'add', blockType: type, id: crypto.randomUUID(), place })
            }
          >
            {t(`bulkEmail.blocks.types.${type}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** "Move to…": every other place this block can go (a container cannot go into one). */
function MoveTo({
  block,
  n,
  type,
  root,
  dispatch,
}: { block: BulkBlock; n: number; type: string } & Pick<ListProps, 'root' | 'dispatch'>) {
  const { t } = useTranslation();
  const places = placesFor(root, block.id);
  if (places.length === 0) return null;
  const numberOf = (id: string) => root.findIndex((b) => b.id === id) + 1;
  const label = (p: Place) =>
    p === null
      ? t('bulkEmail.columns.toMain')
      : t(p.side === 'left' ? 'bulkEmail.columns.toLeft' : 'bulkEmail.columns.toRight', {
          n: numberOf(p.container),
        });
  const id = `b-${block.id}-move`;
  return (
    <Select
      id={id}
      aria-label={t('bulkEmail.columns.moveTo', { n, type })}
      // A narrow card (a container's column) puts it on its own line under the title.
      containerClassName="order-last w-full min-w-0 @min-[440px]:order-none @min-[440px]:w-auto @min-[440px]:max-w-[220px]"
      className="h-8 min-w-0 py-0 text-tiny touch:h-11"
      value=""
      onChange={(e) => {
        const target = places.find((p) => placeKey(p) === e.target.value);
        if (target !== undefined) dispatch({ type: 'place', id: block.id, to: target });
      }}
    >
      <option value="" disabled>
        {t('bulkEmail.columns.moveToShort')}
      </option>
      {places.map((p) => (
        <option key={placeKey(p)} value={placeKey(p)}>
          {label(p)}
        </option>
      ))}
    </Select>
  );
}

/** One list of blocks (the main one or a container's side), each with its form and actions. */
function BlockItems({
  list,
  place,
  label,
  ...props
}: ListProps & { list: BulkBlock[]; place: Place; label: string }) {
  const { t } = useTranslation();
  const { root, problems, serverProblems, dispatch } = props;
  const full = countBlocks(root) >= BULK_LIMITS.blocks;
  return (
    <ol role="list" className="flex flex-col gap-3" aria-label={label}>
      {list.map((block, index) => {
        const n = index + 1;
        const type = t(`bulkEmail.blocks.types.${block.type}`);
        const notReady = serverProblems.filter((p) => p.blockId === block.id);
        const invalid = notReady.length > 0 || problems[block.id] !== undefined;
        return (
          <li
            key={block.id}
            data-testid={`block-${block.id}`}
            // The preview's highlight finds the card by this id and marks it `data-hl`
            // (`preview-highlight.ts`); a click in the preview focuses it.
            data-block-id={block.id}
            tabIndex={-1}
            className={cn(
              // Its own container: the forms lay out by the card's width, so a card inside a
              // split container's column never overflows.
              '@container flex min-w-0 flex-col gap-4 rounded-xl border-2 border-border bg-card p-4 outline-none transition-colors duration-(--duration-fast) data-[hl=active]:border-brand-purple data-[hl=hover]:border-brand-purple/45 aria-invalid:border-destructive',
              place !== null && 'p-3',
            )}
            aria-invalid={invalid ? true : undefined}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-semibold">
                {n}
              </span>
              <h3 className="min-w-0 flex-1 truncate text-button font-semibold">{type}</h3>
              <MoveTo block={block} n={n} type={type} root={root} dispatch={dispatch} />
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
              {index < list.length - 1 && (
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
            {block.type === 'columns' && (
              <div
                // The two sides stack (left first) until the card is wide enough for both
                // sides' forms; side by side they follow the ratio, never below 300 px each.
                className={cn(
                  'grid gap-3 @min-[720px]:gap-0',
                  block.ratio === '33-67'
                    ? '@min-[720px]:grid-cols-[minmax(300px,1fr)_auto_minmax(300px,2fr)]'
                    : block.ratio === '67-33'
                      ? '@min-[720px]:grid-cols-[minmax(300px,2fr)_auto_minmax(300px,1fr)]'
                      : '@min-[720px]:grid-cols-[minmax(300px,1fr)_auto_minmax(300px,1fr)]',
                )}
              >
                {(['left', 'right'] as const).map((side) => {
                  const sidePlace = { container: block.id, side };
                  const sideLabel = t(`bulkEmail.columns.${side}`, { n });
                  return [
                    side === 'right' && (
                      <span
                        key="line"
                        aria-hidden="true"
                        className={cn(
                          'hidden @min-[720px]:mx-3 @min-[720px]:block @min-[720px]:w-0.5 @min-[720px]:rounded-full',
                          block.divider ? 'bg-foreground/25' : 'bg-transparent',
                        )}
                      />
                    ),
                    <section
                      key={side}
                      aria-label={sideLabel}
                      className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted p-3"
                    >
                      <h4 className="text-tiny font-semibold">{sideLabel}</h4>
                      {block[side].length === 0 ? (
                        <p className="text-micro text-muted-foreground">
                          {t('bulkEmail.columns.empty')}
                        </p>
                      ) : (
                        <BlockItems
                          {...props}
                          list={block[side]}
                          place={sidePlace}
                          label={sideLabel}
                        />
                      )}
                      <AddBlock
                        place={sidePlace}
                        full={full}
                        dispatch={dispatch}
                        labelId={`add-${block.id}-${side}`}
                        label={t('bulkEmail.columns.add', { side: sideLabel })}
                      />
                    </section>,
                  ];
                })}
              </div>
            )}
            {notReady.map((p) => (
              <p key={p.problem} role="alert" className="text-micro text-error-ink">
                {t(`bulkEmail.notReady.${p.problem}`)}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The email's blocks in order, each with its form and Move up / Move down / Move to… / Delete
 * (buttons and selects, not drag and drop: the same on a phone and with a keyboard), then "Add
 * block". A split container holds two such lists. `serverProblems`: the `not_ready` reasons of
 * the last test send, shown at their block.
 */
export function BlockList({
  blocks,
  problems,
  serverProblems,
  dispatch,
}: {
  blocks: BulkBlock[];
  problems: BlockProblems;
  serverProblems: BulkNotReadyProblem[];
  dispatch: (action: BlocksAction) => void;
}) {
  const { t } = useTranslation();
  const full = countBlocks(blocks) >= BULK_LIMITS.blocks;

  return (
    <div className="@container flex flex-col gap-4">
      {blocks.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-border px-5 py-6 text-button text-muted-foreground">
          {t('bulkEmail.blocks.empty')}
        </p>
      ) : (
        <BlockItems
          root={blocks}
          list={blocks}
          place={null}
          label={t('bulkEmail.blocks.title')}
          problems={problems}
          serverProblems={serverProblems}
          dispatch={dispatch}
        />
      )}
      <AddBlock
        place={null}
        full={full}
        dispatch={dispatch}
        labelId="add-block-label"
        label={t('bulkEmail.blocks.add')}
      />
      {full && (
        <p className="text-micro text-muted-foreground">
          {t('bulkEmail.blocks.limit', { max: BULK_LIMITS.blocks })}
        </p>
      )}
    </div>
  );
}
