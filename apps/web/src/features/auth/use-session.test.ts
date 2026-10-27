import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { draftKey, readDraft, saveDraft } from '@/features/chat/drafts';
import { clearSession, sessionQuery } from './use-session';

describe('clearSession', () => {
  it('forgets the user, their cached data and their unsent chat drafts', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQuery.queryKey, { id: 'u1' } as never);
    queryClient.setQueryData(['groups'], []);
    saveDraft(draftKey('c1'), 'half a message');

    clearSession(queryClient);

    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeNull();
    expect(queryClient.getQueryData(['groups'])).toBeUndefined();
    // The next person who signs in on this tab does not see it (no reload on logout).
    expect(readDraft(draftKey('c1'))).toBe('');
  });
});
