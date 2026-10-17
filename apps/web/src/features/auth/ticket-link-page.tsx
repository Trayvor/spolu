import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { z } from 'zod';
import { ApiError, apiSend } from '@/lib/api';
import { linkEmail } from './redirect';

/** Sign in with the one-click link of a "Ticket created" email; answers the ticket's id. */
async function signInWithTicketLink(token: string): Promise<string> {
  const schema = z.object({ ticketId: z.string() });
  return (await apiSend('POST', '/auth/ticket-link/sign-in', { token }, schema)).ticketId;
}

/**
 * `/t#<token>`: the one-click link of the "Ticket created" email (ADR 0020). The token is in the
 * fragment, so it reaches no server log; it is posted once, and the page is replaced in the
 * history. Signed in, the visitor goes to the ticket (the signed-in layout asks for an empty name
 * first); a refused link goes to the login page with a notice and the email filled in.
 */
export function TicketLinkRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const [token] = useState(hash);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const toLogin = (email?: unknown) => {
      const known = linkEmail(email);
      const query = `notice=linkExpired${known ? `&email=${encodeURIComponent(known)}` : ''}`;
      return navigate({ href: `/login?${query}`, replace: true });
    };
    if (!token) {
      void toLogin();
      return;
    }
    signInWithTicketLink(token).then(
      async (ticketId) => {
        // The link may have replaced another user's session: forget everything cached for them.
        queryClient.removeQueries();
        await navigate({ to: '/tickets/$ticketId', params: { ticketId }, replace: true });
      },
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 400) {
          void toLogin((e.body as { email?: unknown } | undefined)?.email);
        } else if (e instanceof ApiError && e.status === 429) setError(t('login.errors.tooMany'));
        else setError(t('errors.generic'));
      },
    );
  }, [token, navigate, queryClient, t]);

  if (!error) return null;
  return (
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
      <p role="alert">{error}</p>
      <Link to="/login" className="self-start font-semibold underline underline-offset-4">
        {t('login.title')}
      </Link>
    </Card>
  );
}
