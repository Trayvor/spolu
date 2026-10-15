export const SocketEvents = {
  ping: 'system:ping',
  groupJoin: 'group:join',
  groupLeave: 'group:leave',
} as const;

export type PingAck = { pong: true; at: string };

/** Payload of `group:join` and `group:leave`. */
export type GroupRoomPayload = { groupId: string };
export type GroupJoinAck = { ok: true } | { ok: false; error: 'not_found' };
