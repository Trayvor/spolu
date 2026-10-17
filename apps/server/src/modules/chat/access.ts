import { and, eq, isNull } from 'drizzle-orm';
import type { NotificationKind, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientGroupIds } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import type { FileReadRule } from '../files/read-rules.js';
import { canReadChannel } from './policy.js';
import { channels, messageAttachments, messages } from './schema.js';

/** What the access rules need of a channel. */
export type ChannelRef = {
  id: string;
  groupId: string;
  kind: string;
  ticketId: string | null;
};

/**
 * How another module's channel kind is read (Phase 21: the ticket chats). The chat module never
 * imports that module; the owner registers its rules at start-up.
 */
export type ChannelKindAccess = {
  /** Whether the actor reads the channel (writes, reads and downloads follow it). */
  canRead(db: Db, actor: SessionUser, channel: ChannelRef): Promise<boolean>;
  /**
   * Rooms that hear the channel's events besides the group room: people who read the channel
   * without being in the group room (a ticket's ziadatel initiator).
   */
  extraRooms(db: Db, channel: ChannelRef): Promise<string[]>;
  /** People who can be mentioned besides the group's pickable people (a ticket's initiator). */
  extraPeople(db: Db, channel: ChannelRef): Promise<{ id: string; name: string }[]>;
  /** Who `@all` reaches in this channel (the people who hear a ticket's updates), instead of the pickable people. */
  allRecipients(db: Db, channel: ChannelRef): Promise<string[]>;
  /**
   * How a message here notifies, instead of the chat kinds: the event kind for its readers (a
   * ticket's audience gets `ticket.message`), who they are, and what the payload adds (the
   * ticket's id, number and subject). Mentions here carry the same additions, so they open the
   * owner's page. Null: the message notifies nobody but the people it names.
   */
  messageNotice(db: Db, channel: ChannelRef): Promise<MessageNotice | null>;
};

export type MessageNotice = {
  kind: NotificationKind;
  recipients: string[];
  payload: Record<string, unknown>;
};

const kinds = new Map<string, ChannelKindAccess>();

export function registerChannelKind(kind: string, access: ChannelKindAccess): void {
  kinds.set(kind, access);
}

/** The registered rules of a channel's kind; null for the group and task chats. */
export function channelKindAccess(channel: { kind: string }): ChannelKindAccess | null {
  return channel.kind === 'group' || channel.kind === 'task'
    ? null
    : (kinds.get(channel.kind) ?? null);
}

/**
 * Whether the actor reads the channel: the group and task chats by their group (`canReadChannel`),
 * other kinds by their owner's rules; a kind nobody registered is read by no one.
 */
export async function actorReadsChannel(
  db: Db,
  actor: SessionUser,
  channel: ChannelRef,
): Promise<boolean> {
  if (channel.kind === 'group' || channel.kind === 'task') {
    return canReadChannel(actor, channel, isAdmin(actor) ? [] : await clientGroupIds(db, actor.id));
  }
  const access = kinds.get(channel.kind);
  return access ? access.canRead(db, actor, channel) : false;
}

/** The rooms besides the group room that hear the channel's messages (none for group and task chats). */
export async function extraRoomsOf(db: Db, channel: ChannelRef): Promise<string[]> {
  const access = channelKindAccess(channel);
  return access ? access.extraRooms(db, channel) : [];
}

/**
 * A file attached to a message of a channel the actor reads is readable (Phase 21: a ziadatel
 * reads the files of their ticket's chat, though not the group's other files). Registered with
 * the files module at start-up.
 */
export const fileInReadableChannel: FileReadRule = async (db, actor, file) => {
  const rows = await db
    .selectDistinct({
      id: channels.id,
      groupId: channels.groupId,
      kind: channels.kind,
      ticketId: channels.ticketId,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(and(eq(messageAttachments.fileId, file.id), isNull(messages.deletedAt)));
  for (const channel of rows) {
    if (
      channel.kind !== 'group' &&
      channel.kind !== 'task' &&
      (await actorReadsChannel(db, actor, channel))
    ) {
      return true;
    }
  }
  return false;
};
