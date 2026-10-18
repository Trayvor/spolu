import { createContext, createElement, useContext, type ReactNode } from 'react';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { GroupPersonListSchema, type FileInfo, type GroupPerson } from '@spolu/shared';
import { groupPeopleQuery } from '@/features/groups/api';
import { uploadFile, uploadFileTo } from '@/features/files/upload';
import { apiGet } from '@/lib/api';

/**
 * Where a conversation takes its people (names, mentions) and sends its uploads. The group chat
 * and task chats use the group (`/groups/:id/people`, `/groups/:id/files`). A ticket chat (Phase 21)
 * reads its people from the channel, which adds the ticket's initiator and is open to a requester
 * who cannot read the group, and uploads through the ticket.
 */
export interface ChatScope {
  /** Read the people from `/channels/<id>/people` instead of the group's. */
  peopleChannelId?: string;
  /** Upload to this API path (under `/api`) instead of the group's files. */
  uploadPath?: string;
  /**
   * Phase 28: the reader does not read the group's knowledge (a žiadateľ in a ticket chat): no
   * knowledge picker, and attached items open read-only through their message.
   */
  knowledgeViaMessage?: boolean;
  /**
   * F7: the name a canned reply's `{{name}}` takes when the message quotes no one (a ticket
   * chat: its initiator).
   */
  replyName?: string;
}

const ChatScopeContext = createContext<ChatScope>({});

export function ChatScopeProvider({ scope, children }: { scope: ChatScope; children: ReactNode }) {
  return createElement(ChatScopeContext.Provider, { value: scope }, children);
}

/** The people of one channel: its group's pickable people plus the channel kind's own. */
export const channelPeopleQuery = (channelId: string) =>
  queryOptions({
    queryKey: ['chat', 'people', channelId],
    queryFn: () =>
      apiGet(`/channels/${encodeURIComponent(channelId)}/people`, GroupPersonListSchema),
  });

/** The people query of the conversation around the caller (see `ChatScope`). */
export function chatPeopleQuery(scope: ChatScope, groupId: string) {
  return scope.peopleChannelId
    ? channelPeopleQuery(scope.peopleChannelId)
    : groupPeopleQuery(groupId);
}

export function useChatScope(): ChatScope {
  return useContext(ChatScopeContext);
}

export function useChatPeople(groupId: string): UseQueryResult<GroupPerson[]> {
  return useQuery(chatPeopleQuery(useChatScope(), groupId));
}

/** Uploads one file where the conversation around the caller keeps its files. */
export function useChatUpload(
  groupId: string,
): (file: File, onProgress?: (fraction: number) => void) => Promise<FileInfo> {
  const { uploadPath } = useChatScope();
  return (file, onProgress) =>
    uploadPath ? uploadFileTo(uploadPath, file, onProgress) : uploadFile(groupId, file, onProgress);
}
