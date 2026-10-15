import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { SocketEvents, type GroupJoinAck, type GroupRoomPayload } from '@spolu/shared';
import { getSocket } from '@/lib/socket';

/**
 * Keeps the socket in the room of a group. Returns a counter that grows after every
 * acknowledged join (the first one and every rejoin after a reconnect); it is 0 until then.
 * Consumers run their catch-up / refetch when it changes, so nothing written between
 * `connect` and the join is missed. A `not_found` ack is not permanent: the next `connect`
 * tries again, nothing else retries.
 */
export function useGroupRoom(groupId: string): number {
  // Tagged with the group so a switch reads as 0 until the new room is joined.
  const [state, setState] = useState({ groupId, joins: 0 });

  useEffect(() => {
    const socket = getSocket();
    const payload: GroupRoomPayload = { groupId };
    let active = true;

    const join = () => {
      socket.emit(SocketEvents.groupJoin, payload, (ack?: GroupJoinAck) => {
        if (!active || !ack?.ok) return;
        setState((s) => ({ groupId, joins: (s.groupId === groupId ? s.joins : 0) + 1 }));
      });
    };

    if (socket.connected) join();
    socket.on('connect', join);

    return () => {
      active = false;
      socket.off('connect', join);
      if (socket.connected) socket.emit(SocketEvents.groupLeave, payload);
    };
  }, [groupId]);

  return state.groupId === groupId ? state.joins : 0;
}

export const GroupRoomContext = createContext(0);

/** Provides the join counter of the group layout's room to the tabs below it. */
export function GroupRoomProvider({ joins, children }: { joins: number; children: ReactNode }) {
  return createElement(GroupRoomContext.Provider, { value: joins }, children);
}

/** The join counter of the surrounding group room; 0 outside a `GroupRoomProvider`. */
export function useGroupRoomJoins(): number {
  return useContext(GroupRoomContext);
}
