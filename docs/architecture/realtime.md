# Realtime

Socket.IO runs in the same process as the API, as a single instance (no Redis adapter).

Built so far: `attachSocket(app, config, auth)` in `apps/server/src/infra/realtime/socket.ts` (called by `buildApp`, available as `app.io`) serves Socket.IO at `/socket.io` and answers the `system:ping` event with an ack `{ pong: true, at: <ISO string> }`. The web client uses the ping as a liveness check: `useSocketStatus` (`apps/web/src/features/system/use-socket-status.ts`) pings on connect and every 30 s with a 5 s ack timeout and shows the result on the home status card.

**Client lifecycle.** `getSocket()` (`apps/web/src/lib/socket.ts`) creates the one shared socket with `autoConnect: false`, because the server refuses a handshake without a session. The signed-in layout (`features/auth/authed-layout.tsx`, a lazy chunk) calls `connectSocket()` once the session is known and `disconnectSocket()` when the session goes (logout, a 401 from any query or mutation) or the layout unmounts. A `connect_error` with message `unauthorized` clears the cached session and sends the user to `/login`; the socket is not reconnected. `server_error` is ignored: the user stays signed in and the next login or reload connects again.

## Handshake authentication

An `io.use` middleware runs on every connection:

1. **Origin.** In production the handshake `Origin` header must equal `new URL(PUBLIC_URL).origin`; a foreign or missing Origin gets `connect_error` `forbidden_origin`. (CORS alone does not stop a cross-site WebSocket handshake.) In development any origin is accepted. Socket.IO CORS also allows only the `PUBLIC_URL` origin in production (any origin in development).
2. **Session.** The session cookie of the handshake is read with `getSessionUserFromHeaders` (same logic as the HTTP routes). No session, or a disabled user, gets `connect_error` `unauthorized`. A failing session lookup (e.g. the database is down) gets `connect_error` `server_error` (logged server-side), so a client can tell "log in again" from "try again later". Socket.IO clients do not reconnect automatically after a middleware error, which is wanted: in Task 8 the web will send the user to `/login` on `unauthorized` instead of retrying.
3. **User room.** On success `socket.data.user` is the `SessionUser` and the socket joins the room `user:<id>` (`userRoom` in `rooms.ts`). `disconnectUser(io, userId)` closes every socket of that user; call it when a user is removed or disabled.

## Rules

- **Sockets are push-only.** Clients never send writes over a socket. Every write goes through the HTTP API, which then emits an event. See [overview.md](overview.md).
- **Permissions are checked on join.** A socket may join a room only if the module's policy function allows it (see [permissions.md](permissions.md)).

## Rooms

| room | who joins | carries |
|---|---|---|
| `user:<id>` | every socket of that user, on connect | events for one user (admin changes, notifications) |
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
