# Pet Context Companion

Pet Context Companion is a local cross-platform thought bubble for the OpenAI Codex desktop pet. It attaches itself to the left of the native pet when Codex exposes its current anchor, then shows the active task's context-window pressure and token totals. It can also speak short status updates using the operating system's installed voices.

It is an independent community project and is not affiliated with or endorsed by OpenAI.

## What it shows

- The current Codex task, with its local task name.
- Current context-window usage: `used tokens / model context window` and percentage.
- Cumulative input and output tokens for the active task.
- A working or idle state based on recent local session activity.
- An optional spoken update.

The panel reads the local Codex JSONL session files. It does not send telemetry, source code, prompts, or chat messages over the network.

## Requirements

- Windows, macOS, or Linux.
- Node.js 20 or newer.
- OpenAI Codex desktop app, signed in and used at least once.

## Run it

```powershell
git clone https://github.com/SamPetkov/pet-context-companion.git
cd pet-context-companion
npm install
npm start
```

Open or wake your Codex pet first, then launch the companion. The native pet remains untouched. On Codex installations that expose the pet anchor in local state, the bubble is placed immediately to its left. Otherwise it appears near the lower-right of the active display. Drag the bubble to fine-tune its placement.

Use `Ctrl+Shift+P` to show or hide the panel. The speaker button enables spoken updates. The refresh button reloads local session telemetry immediately.

## Data and privacy

Codex writes session metadata and token telemetry to `%USERPROFILE%\.codex`. The companion reads only these fields from recent session records:

- `id`, `thread_name`, `updated_at`, and workspace path.
- `model_context_window` and latest `last_token_usage`.
- Aggregate `total_token_usage` input/output counts.

It deliberately does not read or render user prompts, assistant text, tool output, repository file contents, authentication data, or API keys. The fields are read locally and never leave your computer.

## Current scope

Custom Codex pet packages are artwork plus metadata; they do not execute code in the native desktop overlay. Codex desktop pets are also rendered by OpenAI's application and do not expose a public extension API. This project therefore cannot change the native pet's animation or attach HTML inside that window. Instead, it keeps the pet intact and provides a nearby companion bubble that reacts to the same local task data.

Codex session-log schemas can change. When no `token_count` event is available for a task, the panel clearly reports that context telemetry has not arrived yet instead of guessing.

## Development

```powershell
npm test
npm run check
```

The parser has fixture-based tests and accepts an alternate `CODEX_HOME` environment variable, making it straightforward to test against copied, redacted session fixtures.

## License

[MIT](LICENSE)
