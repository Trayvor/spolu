import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  WEEKLY_SUMMARY_LIMITS,
  type WeeklySummaryDto,
  type WeeklySummaryItem,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';

export const TEXTAREA =
  'w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button text-foreground focus:border-foreground disabled:opacity-60';

/**
 * One section of the draft (spec §12.3): a textarea per item, its ref's link, Up / Down / Remove,
 * and "Add item". Plain textareas and buttons: no drag and drop, no rich text.
 */
export function SectionEditor({
  title,
  items,
  refs,
  disabled,
  onChange,
}: {
  title: string;
  items: WeeklySummaryItem[];
  refs: WeeklySummaryDto['refs'];
  disabled: boolean;
  onChange: (items: WeeklySummaryItem[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="text-body font-semibold">
        {title}
      </h2>
      {items.length > 0 && (
        <ol className="flex flex-col gap-3">
          {items.map((item, index) => {
            const ref = refs[item.id];
            return (
              <li key={item.id} className="flex flex-col gap-2">
                <textarea
                  aria-label={t('weeklySummary.editor.item', { section: title, n: index + 1 })}
                  value={item.text}
                  rows={2}
                  maxLength={WEEKLY_SUMMARY_LIMITS.item}
                  disabled={disabled}
                  className={TEXTAREA}
                  onChange={(e) =>
                    onChange(
                      items.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)),
                    )
                  }
                />
                {!disabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    {ref && (
                      <Link
                        to={ref.url as never}
                        className="mr-auto text-micro underline underline-offset-4"
                      >
                        {t(`weeklySummary.editor.open.${ref.kind}`)}
                      </Link>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      {t('weeklySummary.editor.up')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === items.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      {t('weeklySummary.editor.down')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onChange(items.filter((it) => it.id !== item.id))}
                    >
                      {t('weeklySummary.editor.remove')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!disabled && items.length < WEEKLY_SUMMARY_LIMITS.items && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onChange([...items, { id: crypto.randomUUID(), ref: null, text: '' }])}
        >
          {t('weeklySummary.editor.add')}
        </Button>
      )}
    </section>
  );
}
