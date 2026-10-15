export const SocketEvents = { ping: 'system:ping' } as const;

export type PingAck = { pong: true; at: string };
