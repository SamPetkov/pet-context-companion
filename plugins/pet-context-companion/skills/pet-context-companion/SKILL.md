---
name: pet-context-companion
description: Install, start, update, check, or troubleshoot the Pet Context Companion desktop overlay for Codex pets, repository context windows, account usage limits, active agents, and voice briefings. Use when the user asks to run or manage Pet Context Companion or wants an easier installation from its GitHub repository.
---

# Pet Context Companion

Use the bundled cross-platform launcher at `../../scripts/install-and-launch.js`, resolving the path relative to this skill directory.

## Choose The Action

- For a first install or an explicit reinstall, run `node <launcher> --install`.
- To open the existing companion, run `node <launcher> --start`. If it is not installed yet, this action installs it first.
- To pull the newest public release and reopen it, run `node <launcher> --update`.
- To inspect the installation without changing it, run `node <launcher> --check`.

When the user's request is simply to use the companion and its state is unknown, prefer `--start`.

## Report Results

Tell the user whether the companion was installed, updated, started, or only checked. Include the installation path printed by the launcher when useful. If a prerequisite is missing, relay the launcher's exact missing prerequisite and the smallest corrective step.

Do not request or expose API keys. The companion reads local Codex session metadata and asks the local Codex app-server for quota information; it does not require OpenAI API credentials.

## Product Boundary

This is a Codex plugin that controls a local desktop companion. Do not describe it as a ChatGPT App or legacy ChatGPT web plugin: those surfaces cannot provide this local Electron overlay or direct access to the user's local Codex session files.
