# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in WhisperClick, please report it responsibly.

**Do not open a public issue.** Instead, please email:

**whisperclick.security@proton.me**

Include:

- A description of the vulnerability
- Steps to reproduce (if applicable)
- The version of WhisperClick affected
- Any potential impact assessment

## Response Timeline

- **Acknowledgment**: Within 48 hours of report
- **Initial assessment**: Within 7 days
- **Fix or mitigation**: Best effort, typically within 30 days for confirmed vulnerabilities

## Scope

The following are in scope:

- WhisperClick application code (`src/`, `tools/`, build scripts)
- Installer and packaging scripts
- Credential handling (API key storage, keyring usage)
- Local data storage security (`~/.config/whisperclick/`)

The following are out of scope:

- Third-party API provider security (OpenAI, Google) — report to them directly
- Operating system vulnerabilities
- Issues requiring physical access to the machine

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Security Design

- API keys are stored via OS-native credential storage (`keyring` library), not in plain text
- No network telemetry or background connections
- Audio data is not persisted beyond 24-hour auto-cleanup
- The application runs with standard user privileges (no admin required)
