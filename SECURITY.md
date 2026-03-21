# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

Older versions (pre-release) are not supported.

## Scope

PocketDex is designed for **local network use only**.
It is not intended to be exposed directly to the public internet without a reverse proxy and HTTPS.

Known, intentional design constraints (not vulnerabilities):
- The QR code JWT is short-lived and single-use by design
- No authentication is required on the same local network beyond the QR pairing step
- Codex app-server communication uses stdio by default; the optional WebSocket transport is for development use only

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for security vulnerabilities.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/Mikeore/PocketDex/security/advisories/new) to report issues confidentially.

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Your environment (OS, Node.js version, PocketDex version)
- Any suggested mitigations, if you have them

You can expect an acknowledgement within **72 hours** and a resolution or status update within **14 days**.
