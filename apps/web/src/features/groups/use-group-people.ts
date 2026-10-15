import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GroupPerson } from '@spolu/shared';
import { groupPeopleQuery } from './api';

export function useGroupPeople(groupId: string): UseQueryResult<GroupPerson[]> {
  return useQuery(groupPeopleQuery(groupId));
}
