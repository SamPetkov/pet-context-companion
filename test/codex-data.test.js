const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getOverview, parseJsonLines } = require('../src/codex-data');

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

function writeFixture(root) {
  const sessionDirectory = path.join(root, 'sessions', '2026', '07', '10');
  fs.mkdirSync(sessionDirectory, { recursive: true });
  fs.writeFileSync(path.join(root, '.codex-global-state.json'), JSON.stringify({
    'electron-avatar-overlay-open': true,
    'electron-avatar-overlay-bounds': { anchor: { x: 1673, y: 781, width: 108, height: 116 } },
  }));
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), `${JSON.stringify({
    id: SESSION_ID,
    thread_name: 'Build task context overlay',
    updated_at: '2026-07-10T00:00:00.000Z',
  })}\n`);
  fs.writeFileSync(path.join(sessionDirectory, `rollout-2026-07-10T00-00-00-${SESSION_ID}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: 'C:\\work\\pet-companion' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        info: {
          model_context_window: 272000,
          last_token_usage: { total_tokens: 68000 },
          total_token_usage: { input_tokens: 140000, output_tokens: 9000 },
        },
      },
    }),
  ].join('\n'));
}

test('parseJsonLines ignores a malformed JSONL row', () => {
  assert.deepEqual(parseJsonLines('{"ok":true}\nnot-json\n'), [{ ok: true }]);
});

test('getOverview derives task context and total token usage from local telemetry', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-companion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root);

  const overview = getOverview({ codexHome: root, now: Date.now() });

  assert.equal(overview.pet.overlayOpen, true);
  assert.deepEqual(overview.pet.anchor, { x: 1673, y: 781, width: 108, height: 116 });
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.tasks[0].title, 'Build task context overlay');
  assert.equal(overview.tasks[0].context.used, 68000);
  assert.equal(overview.tasks[0].context.window, 272000);
  assert.equal(overview.tasks[0].context.percent, 25);
  assert.equal(overview.tasks[0].tokens.input, 140000);
  assert.equal(overview.tasks[0].tokens.output, 9000);
});
