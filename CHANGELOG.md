# Changelog

All notable changes to PocketDex will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-03-20

### Initial Release 🎉

First public GitHub-ready release of PocketDex — a QR-code-based mobile remote
control for Codex CLI.

#### Added

- Release-ZIP-first launcher flow (`start.sh`, `start.bat`, `npm start`) with shared bootstrap logic.
- Bundled local `@openai/codex` dependency pinned to `0.116.0`, so PocketDex does not require a global Codex install.
- Automatic `codex login` flow with `--device-auth` fallback.
- Default **stdio JSONL** Codex transport with optional **WebSocket debug fallback** via `POCKETDEX_CODEX_TRANSPORT=ws`.
- Compatibility layer for Codex app-server notifications and server requests (`src/codex-protocol.js`).
- Auto-restart and client hot-swap when the Codex child process exits unexpectedly.
- QR authentication, PWA mobile UI, approval cards, live streaming, model picker, and push-notification support.
- Protocol compatibility tests for transport selection and normalized lifecycle events.

#### Fixed

- Fixed patch approval diff rendering so file change previews render DOM nodes instead of `[object HTMLDivElement]`.
- Detached the temporary early-exit listener once Codex startup succeeds, preventing duplicate restart handling.
- Added request timeouts for Codex RPC calls to avoid permanently pending promises.
- Synced approval countdowns to the server timeout and added a dedicated `approval_timeout` socket event for the mobile UI.

[0.1.0]: https://github.com/Mikeore/Pocketdex/releases/tag/v0.1.0
