import { lazy, Suspense } from 'react';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { withNamespaces } from '@/i18n/namespaces';
import type { ClaudeSource } from './solve-with-claude';

// The button, its dialog, its texts and the prompt helpers load only for admins.
const SolveWithClaude = lazy(
  withNamespaces(['openInClaude', 'forms'], () => import('./solve-with-claude')),
);

/** "Vyriešiť s Claude" for admins (Phase 29); nothing for anyone else. */
export function OpenInClaude({ source, compact }: { source: ClaudeSource; compact?: boolean }) {
  const me = useSession();
  if (!isAdmin(me)) return null;
  return (
    <Suspense fallback={null}>
      <SolveWithClaude source={source} compact={compact} />
    </Suspense>
  );
}
