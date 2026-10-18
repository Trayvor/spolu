import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { aiStatusQuery } from '@/features/task-split/api';
import { withNamespaces } from '@/i18n/namespaces';
import type { TicketDraftButtonProps } from './ticket-draft';

// The button, its dialog, its schema and its texts load only for admins, with the AI on.
const TicketDraftButton = lazy(
  withNamespaces(['ticketDraft', 'forms'], () => import('./ticket-draft')),
);

/**
 * "Navrhnúť odpoveď" in a ticket chat's composer (2026-10-19): admins only, and only while the
 * server runs the ticket draft AI (`GET /api/ai/status`); nothing for anyone else.
 */
export function TicketDraft(props: TicketDraftButtonProps) {
  const admin = isAdmin(useSession());
  const { data } = useQuery({ ...aiStatusQuery, enabled: admin });
  if (!admin || !data?.ticketDraft) return null;
  return (
    <Suspense fallback={null}>
      <TicketDraftButton {...props} />
    </Suspense>
  );
}
