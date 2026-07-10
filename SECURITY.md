# Security Policy

## Supported installation

Install only from the official repository and Codex plugin marketplace:

```powershell
codex plugin marketplace add SamPetkov/pet-context-companion
codex plugin add pet-context-companion@pet-context-companion
```

The launcher verifies that an existing installation points to `https://github.com/SamPetkov/pet-context-companion`, is on the `main` branch, and has no modified tracked files before it updates or launches.

## Dependency verification

The launcher requires `package-lock.json` and uses `npm ci` with lifecycle scripts disabled. This verifies the integrity hashes recorded in the lockfile while preventing dependency `preinstall`, `install`, and `postinstall` hooks from running. It then invokes only Electron's bundled bootstrap script, which verifies the Electron archive against its packaged checksums.

## Data handling

The companion reads local Codex session metadata and token counters. It does not read user prompts, assistant messages, source code, authentication data, or API keys. Its only local process request is Codex's `account/rateLimits/read` app-server method for account-window percentages and reset times.

## Windows warnings

This project is not currently published as a code-signed Windows application. Microsoft Defender SmartScreen can therefore show an unknown-app warning for a newly downloaded Electron binary even when it is not malware. Do not bypass an explicit malware detection or an alert from a security product. Verify that the installation came from the official repository and report the exact product name, detection text, and file path before continuing.

Eliminating SmartScreen reputation warnings requires signing released Windows artifacts with a verified publisher identity or publishing through the Microsoft Store. A self-signed certificate does not establish SmartScreen reputation.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when available. Do not include secrets, session logs, prompts, or account data in a public issue.
