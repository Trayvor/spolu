import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { resetInstallNever } from '@/features/notifications/prompt-rules';
import { sessionQuery } from './use-session';

/**
 * What every successful login does next (the email code and the passkey): show the install
 * card again (X20), reload the session and replace the login page with `redirectTo`.
 */
export function useCompleteLogin(redirectTo: string): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    // X20: a new login shows the install card again, even after "never on this device".
    resetInstallNever();
    // refetchType 'all': the session query has no observer on this page.
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey, refetchType: 'all' });
    // In place of the login page: Back from there must not show it again.
    router.history.replace(redirectTo);
  };
}
