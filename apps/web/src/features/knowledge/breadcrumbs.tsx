import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronIcon } from './icons';

export type Crumb = { key: string; label: string; onClick?: () => void };

const crumbButton =
  'max-w-[16rem] truncate rounded-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring';

/**
 * Where the open folder is: each crumb but the last is a link-like button. On phones a path of
 * more than three crumbs keeps the first and the last two, the middle as "…".
 */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useTranslation();
  const collapse = crumbs.length > 3;
  return (
    <nav aria-label={t('knowledge.folders.path')}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-button">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const hiddenOnPhone = collapse && i > 0 && i < crumbs.length - 2;
          return (
            <Fragment key={crumb.key}>
              {collapse && i === 1 && (
                <li aria-hidden="true" className="flex items-center gap-1 min-[641px]:hidden">
                  <ChevronIcon size={14} />
                  <span className="text-muted-foreground">…</span>
                </li>
              )}
              <li
                className={`flex min-w-0 items-center gap-1 ${hiddenOnPhone ? 'max-[640px]:hidden' : ''}`}
              >
                {i > 0 && (
                  <span className="text-muted-foreground">
                    <ChevronIcon size={14} />
                  </span>
                )}
                {last || !crumb.onClick ? (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className="max-w-[20rem] truncate font-semibold text-foreground"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <button type="button" onClick={crumb.onClick} className={crumbButton}>
                    {crumb.label}
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
