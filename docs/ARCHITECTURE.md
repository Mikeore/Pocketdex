# PocketDex — Architecture

## Overview

PocketDex sits between Codex CLI's built-in app-server and the smartphone browser.
By default it speaks stdio JSONL to Codex, then re-broadcasts the normalized stream to the phone over Socket.IO.

```
┌─────────────────────────────────────────────────────────────────┐
│  PC (developer's machine)                                        │
│                                                                  │
│  ┌──────────────────┐    stdio JSONL   ┌──────────────────────┐  │
│  │  codex app-server│ ◄──────────────► │   PocketDex Proxy    │  │
│  │   stdio://       │                  │   Node.js + Express  │  │
│  │  (default)       │                  │   Socket.IO server   │  │
│  └──────────────────┘                  └──────────┬───────────┘  │
│                                                   │              │
└───────────────────────────────────────────────────┼─────────────┘
                                                    │ Socket.IO
                                               LAN / Wi-Fi
                                                    │
                                        ┌───────────▼───────────┐
                                        │   PWA (phone browser) │
                                        │   Chat UI             │
                                        │   Approval buttons    │
                                        │   Reasoning display   │
                                        └───────────────────────┘
```

---

## Component Details

### 1. `codex app-server` (Codex CLI built-in)

PocketDex now prefers the documented default transport:

```bash
codex app-server --listen stdio://
```

Optional debug / compatibility mode:

```bash
POCKETDEX_CODEX_TRANSPORT=ws codex app-server --listen ws://127.0.0.1:PORT
```

- Speaks newline-delimited **JSONL over stdio** by default
- WebSocket remains available as an opt-in debug transport
- Full TypeScript protocol types are in `docs/protocol/` (auto-generated)

Key method groups:

| Group | Methods |
|-------|---------|
| Connection | `initialize` |
| Thread management | `thread/start`, `thread/resume`, `thread/fork`, `thread/list` |
| Turn control | `turn/start`, `turn/steer`, `turn/interrupt` |
| Config | `model/list`, `config/read`, `config/value/write` |

Server-initiated requests (approvals the client MUST respond to):

| Method | Meaning |
|--------|---------|
| `item/commandExecution/requestApproval` | Codex wants to run a shell command |
| `item/fileChange/requestApproval` | Codex wants to edit a file |
| `item/permissions/requestApproval` | Codex wants expanded permissions |
| `item/tool/requestUserInput` | Codex needs freeform input |

---

### 2. PocketDex Proxy (`src/`)

#### `codex-process.js`
Responsible for starting and monitoring the `codex app-server` child process.

```
spawn("codex", ["app-server", "--listen", "stdio://", "--session-source", "pocketdex"])
```

- Default transport: **stdio JSONL**
- Optional fallback: `POCKETDEX_CODEX_TRANSPORT=ws`
- Watches for process exit and reconnects a fresh Codex client if Codex restarts

#### `codex-client.js`
Transport-aware JSON-RPC client with two implementations:

- `StdioCodexClient` — default and preferred
- `WsCodexClient` — compatibility / debug fallback

Both clients:
- Send `initialize`, then `initialized`
- Normalize incoming notifications and server requests through `src/codex-protocol.js`
- Forward stable message shapes to Socket.IO
- Keep pending requests and reject them cleanly on disconnect

#### `qr-auth.js`
On startup:
1. Detect local network IP
2. Generate JWT signed with a random secret, TTL = 15 minutes
3. Encode `http://LOCAL_IP:3000?token=JWT` as a QR code
4. Print QR code to terminal using `qrcode` library (terminal rendering)

On incoming Socket.IO connection:
- Extract token from handshake query `?token=`
- Verify JWT — reject if invalid or expired
- Accept exactly ONE connection per token (first-scan wins)

#### `message-router.js`
The central message bus:

```
Codex ServerNotification → normalize via `codex-protocol.js` → broadcast to authenticated PWA clients
Codex ServerRequest (approval) → normalize via `codex-protocol.js` → forward to PWA, wait for response, relay back to Codex
PWA turn/start → forward to Codex via transport-aware codex-client
PWA approval response → match to pending ServerRequest, send response to Codex
```

#### `socket-server.js`
Socket.IO v4 server on port `3000` (configurable).

- Serves the static `client/` directory
- Handles Socket.IO auth middleware (JWT validation)
- Namespace: `/codex`
- Events emitted to PWA: `notification` (Codex ServerNotification)
- Events received from PWA: `request` (ClientRequest), `approval` (approval response)

---

### 3. PWA Client (`client/`)

#### `index.html`
Minimal shell. Loads Socket.IO client, marked.js, DOMPurify, xterm.js.
No build step — vanilla HTML/CSS/JS.

#### `app.js`
Main application logic:

- On load: check `?token=` in URL, connect to Socket.IO with token
- **Chat UI**: renders `item/agentMessage/delta` notifications as streaming Markdown
- **Thinking UI**: renders `item/reasoning/summaryTextDelta` as collapsible block
- **Approval UI**: when `item/commandExecution/requestApproval` or `item/fileChange/requestApproval` arrives, show modal overlay with Approve / Reject / Approve All buttons
- **Turn input**: textarea + send button → emits `turn/start` request
- **Interrupt**: stop button → emits `turn/interrupt`
- **Model picker**: `model/list` request on load, renders dropdown

#### `manifest.json`
PWA manifest for home screen installation:
- `display: standalone` — hides browser chrome
- `start_url: /?standalone=1`
- Icons at 192px and 512px (TODO: create icons)

#### `sw.js`
Minimal Service Worker:
- Caches app shell (HTML, CSS, JS) on install
- Network-first for Socket.IO connections
- Allows "Add to Home Screen" on iOS and Android

---

## Message Flow: Starting a Session

```
User scans QR → opens http://192.168.x.x:3000?token=JWT

PWA                    PocketDex Proxy             Codex app-server
 │                           │                            │
 │──connect(token)──────────►│                            │
 │                           │──ws.connect()─────────────►│
 │                           │◄──connected────────────────│
 │                           │──initialize────────────────►│
 │                           │◄──InitializeResponse────────│
 │◄──ready───────────────────│                            │
 │                           │                            │
 │──request(thread/start)───►│──thread/start─────────────►│
 │                           │◄──thread/started────────────│
 │◄──notification────────────│                            │
 │                           │                            │
 │──request(turn/start)─────►│──turn/start───────────────►│
 │                           │◄──turn/started──────────────│
 │◄──notification────────────│                            │
 │                           │◄──item/agentMessage/delta───│  ×N
 │◄──notification (stream)───│                            │
 │                           │◄──turn/completed────────────│
 │◄──notification────────────│                            │
```

## Message Flow: Approval

```
PWA                    PocketDex Proxy             Codex app-server
 │                           │                            │
 │                           │◄──ServerRequest(approval)──│
 │◄──approval_request────────│  (held in pending map)     │
 │                           │                            │
 │  [user taps Approve]      │                            │
 │──approval_response───────►│──JSON-RPC response────────►│
 │                           │  (matched by request id)   │
 │                           │                            │
 │                           │◄──(agent continues)─────────│
```

---

## Security Model

- Codex app-server binds to `127.0.0.1` only — not exposed to network
- PocketDex proxy requires JWT for every Socket.IO connection
- JWT is one-use (first scan wins), short-lived (15 min default)
- No credentials are stored or transmitted to any external service

**Network threat model:** Attacker on the same LAN who intercepts the QR code URL
can connect if they are faster than the legitimate user. Mitigation: use `npm start`
only on trusted networks.

---

## Protocol Reference

All type definitions are in `docs/protocol/` (auto-generated from Codex CLI source).

Key files:
- `ClientRequest.ts` — all requests the client can send to Codex
- `ServerNotification.ts` — all notifications Codex sends to the client
- `ServerRequest.ts` — server-initiated requests requiring client response (approvals)
- `v2/TurnStartParams.ts` — fields for starting a turn (prompt, model, approval policy)
- `v2/ThreadStartParams.ts` — fields for starting a thread

To regenerate after a Codex CLI version upgrade:
```bash
codex app-server generate-ts --out docs/protocol
codex app-server generate-json-schema --out docs/protocol
```
