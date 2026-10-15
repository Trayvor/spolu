# Realtime

Socket.IO runs in the same process as the API, as a single instance (no Redis adapter).

Built so far: `attachSocket` in `apps/server/src/infra/realtime/socket.ts` serves Socket.IO at `/socket.io` and answers the `system:ping` event with an ack `{ pong: true, at: <ISO string> }`. In production CORS allows only `PUBLIC_URL`; in development any origin. The web client uses the ping as a liveness check: `useSocketStatus` (`apps/web/src/features/system/use-socket-status.ts`) pings on connect and every 30 s with a 5 s ack timeout and shows the result on the home status card.

## Before Phase 2 ships

Production Socket.IO `cors` does not reject cross-site WebSocket handshakes (CORS only governs browsers reading responses). Phase 2 adds an `allowRequest` check that `origin === new URL(PUBLIC_URL).origin`, plus socket authentication.

## Rules

- **Sockets are push-only.** Clients never send writes over a socket. Every write goes through the HTTP API, which then emits an event. See [overview.md](overview.md).
- **Permissions are checked on join.** A socket may join a room only if the module's policy function allows it (see [permissions.md](permissions.md)).

## Rooms

| room | who joins | carries |
|---|---|---|
| per group channel | members of that group, and admins | new, edited, deleted messages; read state (assumed; per-user room likely, settle in Phase 4 design) |
| per DM channel | the two participants | the same, for direct messages |
| per task channel | users who can see the task's group | task chat events |
| per group (board) | members of that group, and admins | task and ticket changes |

## Catch-up with `seq`

Every message has a `seq` number that increases by one per channel. After a disconnect the client asks for what it missed instead of relying on an event log.

1. The client keeps the highest `seq` it has seen for each open channel.
2. On (re)connect it re-establishes the socket and rejoins its rooms (the server checks permission on join).
3. Over HTTP it fetches missed messages: `GET` with `channelId` and `lastSeq`. The server checks permission and returns all messages with `seq > lastSeq`, ordered by `seq` ascending.
4. The client merges them by `seq`, ignoring ones it already has, and then handles live events as normal.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server (Socket.IO)
    participant H as HTTP API
    participant DB as PostgreSQL
    Note over C,S: connection drops
    C->>S: reconnect (session cookie)
    S-->>C: connected
    C->>S: join room (channelId)
    S->>S: policy check, e.g. canReadGroup
    S-->>C: joined
    C->>H: GET messages after lastSeq
    H->>DB: select where seq > lastSeq order by seq
    DB-->>H: missed messages
    H-->>C: missed messages
    S-->>C: live events resume
```

The catch-up read is an ordinary HTTP read, so it uses the same permission checks as everything else.
