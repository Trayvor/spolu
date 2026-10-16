import { lazy, Suspense, type ComponentType } from 'react';
import { withNamespaces } from '@/i18n/namespaces';

type NavCountProps = { kind: 'tasks' | 'tickets'; live?: boolean };

/**
 * The Tasks and Tickets counts of the header and the user menu (admins): a lazy chunk
 * (`nav-count`) with the `adminHome` texts, so its query, socket code and labels stay out of the
 * entry chunks. A failed chunk (offline, new deploy) shows no count and never breaks the header.
 */
const LazyCount = lazy((): Promise<{ default: ComponentType<NavCountProps> }> =>
  withNamespaces(['adminHome'], () => import('@/features/admin-home/nav-count'))().catch(() => ({
    default: () => null,
  })),
);

export function NavCount(props: NavCountProps) {
  return (
    <Suspense fallback={null}>
      <LazyCount {...props} />
    </Suspense>
  );
}
