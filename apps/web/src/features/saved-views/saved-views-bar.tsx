import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SAVED_VIEW_LIMITS, type SavedViewPage } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { createSavedView, deleteSavedView, savedViewsQuery } from './api';
import { normalizeViewUrl, STARTER_VIEWS, viewUrl } from './view-url';

export interface SavedViewsBarProps {
  page: SavedViewPage;
  /** The page's filter params: a view keeps only these. */
  keys: readonly string[];
}

const pressed = 'bg-primary text-primary-foreground hover:bg-ink-hover';

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * F5: the person's saved views of a list page, as pills under its filter row: the starter views
 * first, then their own (each removable), the one matching the current filters pressed. "Save
 * view" names the current filters (shown only when some are set). A view is the page's URL, so
 * it is also the link to share. A lazy chunk with its namespace `savedViews`.
 */
export default function SavedViewsBar({ page, keys }: SavedViewsBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = useId();
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const { data } = useQuery(savedViewsQuery(page));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'limit' | 'error'>('idle');

  const current = viewUrl(page, searchStr, keys);
  const starters = (STARTER_VIEWS[page] ?? []).map((v) => ({
    id: `starter:${v.key}`,
    name: t(`savedViews.starter.${v.key}`),
    url: v.url,
    own: false,
  }));
  const own = (data ?? []).map((v) => ({ id: v.id, name: v.name, url: v.url, own: true }));
  const views = [...starters, ...own];
  const isCurrent = (url: string) => current !== null && normalizeViewUrl(url, keys) === current;
  const alreadySaved = views.some((v) => isCurrent(v.url));
  const refresh = () => queryClient.invalidateQueries({ queryKey: savedViewsQuery(page).queryKey });

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!current || trimmed === '' || status === 'busy') return;
    setStatus('busy');
    try {
      await createSavedView({ page, name: trimmed, url: current });
      await refresh();
      setName('');
      setNaming(false);
      setStatus('idle');
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === 'saved_view_limit' ? 'limit' : 'error');
    }
  }

  async function remove(viewId: string) {
    try {
      await deleteSavedView(viewId);
      await refresh();
    } catch {
      setStatus('error');
    }
  }

  if (views.length === 0 && current === null) return null;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t('savedViews.label')}
        className="flex flex-wrap items-center gap-2"
      >
        {views.map((view) => (
          <div key={view.id} className="flex items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-current={isCurrent(view.url) ? 'true' : undefined}
              className={cn(isCurrent(view.url) && pressed, view.own && 'rounded-r-none pr-2')}
              onClick={() => void navigate({ href: view.url })}
            >
              {view.name}
            </Button>
            {view.own && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t('savedViews.remove', { name: view.name })}
                title={t('savedViews.remove', { name: view.name })}
                className={cn('rounded-l-none px-2', isCurrent(view.url) && pressed)}
                onClick={() => void remove(view.id)}
              >
                <CloseIcon />
              </Button>
            )}
          </div>
        ))}
        {current !== null && !alreadySaved && !naming && (
          <span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus('idle');
                setNaming(true);
              }}
            >
              {t('savedViews.save')}
            </Button>
          </span>
        )}
      </div>
      {naming && current !== null && (
        <form noValidate onSubmit={save} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-name`} className="sr-only">
            {t('savedViews.name')}
          </label>
          <Input
            id={`${id}-name`}
            autoFocus
            value={name}
            maxLength={SAVED_VIEW_LIMITS.name}
            placeholder={t('savedViews.name')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(false);
            }}
            className="h-8 w-56 max-w-full"
          />
          <Button type="submit" size="sm" disabled={name.trim() === '' || status === 'busy'}>
            {t('savedViews.confirm')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(false)}>
            {t('savedViews.cancel')}
          </Button>
        </form>
      )}
      {(status === 'limit' || status === 'error') && (
        <p role="alert" className="text-micro text-error-ink">
          {status === 'limit'
            ? t('savedViews.limit', { max: SAVED_VIEW_LIMITS.perPage })
            : t('errors.generic')}
        </p>
      )}
    </div>
  );
}
