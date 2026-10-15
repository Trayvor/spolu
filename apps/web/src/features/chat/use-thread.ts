import { useQuery } from '@tanstack/react-query';
import { threadQuery } from './api';

/** A thread (root and replies). `useChannelMessages` patches it from live events and catch-up. */
export function useThread(rootId: string) {
  return useQuery(threadQuery(rootId));
}
