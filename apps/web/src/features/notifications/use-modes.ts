import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { effectiveGroupMode, type GroupMode, type NotificationModes } from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';
import { notificationModesQuery, setDefaultMode, setGroupMode } from './api';

const KEY = notificationModesQuery.queryKey;

/**
 * Run `save` after writing `next` into the modes cache; put the old cache back if it fails.
 * One place for both the per-group bell and "All groups".
 */
function useOptimisticModes<V>(
  save: (value: V) => Promise<unknown>,
  next: (old: NotificationModes, value: V) => NotificationModes,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onMutate: async (value: V) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData<NotificationModes>(KEY);
      if (previous) queryClient.setQueryData(KEY, next(previous, value));
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
    },
  });
}

/** The signed-in user's mode in one group; `setMode` is optimistic and rolls back on error. */
export function useGroupMode(groupId: string) {
  const role = useSession()?.role;
  const { data } = useQuery(notificationModesQuery);
  const mutation = useOptimisticModes<GroupMode>(
    (mode) => setGroupMode(groupId, mode),
    (old, mode) => ({ ...old, overrides: { ...old.overrides, [groupId]: mode } }),
  );
  const mode =
    data && role
      ? effectiveGroupMode({
          override: data.overrides[groupId] ?? null,
          defaultMode: data.defaultMode,
          role,
        })
      : undefined;
  return { mode, setMode: mutation.mutate, isError: mutation.isError };
}

/** "All groups": set the default and clear every override. */
export function useDefaultMode() {
  const queryClient = useQueryClient();
  const mutation = useOptimisticModes<GroupMode>(
    async (mode) => {
      const saved = await setDefaultMode(mode);
      queryClient.setQueryData(KEY, saved);
    },
    (old, mode) => ({ ...old, defaultMode: mode, overrides: {} }),
  );
  return { setMode: mutation.mutate, isError: mutation.isError };
}
