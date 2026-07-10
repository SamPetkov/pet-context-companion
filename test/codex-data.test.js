const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getOverview, parseJsonLines } = require('../src/codex-data');

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const DUPLICATE_SESSION_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const OTHER_SESSION_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

function writeFixture(root) {
  const sessionDirectory = path.join(root, 'sessions', '2026', '07', '10');
  fs.mkdirSync(sessionDirectory, { recursive: true });
  fs.writeFileSync(path.join(root, '.codex-global-state.json'), JSON.stringify({
    'electron-avatar-overlay-open': true,
    'electron-avatar-overlay-bounds': {
      anchor: { x: 1673, y: 781, width: 108, height: 116 },
      displayBounds: { x: 0, y: 0, width: 1920, height: 1200 },
      displayId: 3535343121,
    },
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
  assert.deepEqual(overview.pet, {
    overlayOpen: true,
    anchor: { x: 1673, y: 781, width: 108, height: 116 },
    displayBounds: { x: 0, y: 0, width: 1920, height: 1200 },
    displayId: 3535343121,
  });
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.tasks[0].title, 'Build task context overlay');
  assert.equal(overview.tasks[0].context.used, 68000);
  assert.equal(overview.tasks[0].context.window, 272000);
  assert.equal(overview.tasks[0].context.percent, 25);
  assert.equal(overview.tasks[0].tokens.input, 140000);
  assert.equal(overview.tasks[0].tokens.output, 9000);
});

test('mapPetAnchorToDisplay converts physical pet coordinates to Electron display coordinates', () => {
  const { mapPetAnchorToDisplay } = require('../src/codex-data');
  assert.deepEqual(
    mapPetAnchorToDisplay({
      anchor: { x: 1628, y: 686, width: 113, height: 123 },
      displayBounds: { x: 0, y: 0, width: 1920, height: 1200 },
    }, {
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
    }),
    { x: 1123, y: 498.3333333333333 },
  );
});

test('getOverview keeps concurrently active threads visible', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-companion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root);
  const sessionDirectory = path.join(root, 'sessions', '2026', '07', '10');
  const indexPath = path.join(root, 'session_index.jsonl');
  const now = Date.now();

  const addSession = (id, threadName, cwd, modifiedAt) => {
    fs.appendFileSync(indexPath, `${JSON.stringify({ id, thread_name: threadName, updated_at: new Date(modifiedAt).toISOString() })}\n`);
    const filePath = path.join(sessionDirectory, `rollout-2026-07-10T00-00-00-${id}.jsonl`);
    fs.writeFileSync(filePath, [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd } }),
      JSON.stringify({ type: 'event_msg', payload: { info: { model_context_window: 1000, last_token_usage: { total_tokens: 500 } } } }),
    ].join('\n'));
    fs.utimesSync(filePath, new Date(modifiedAt), new Date(modifiedAt));
  };

  addSession(DUPLICATE_SESSION_ID, 'Newest pet companion thread', 'c:\\work\\pet-companion\\', now + 1_000);
  addSession(OTHER_SESSION_ID, 'Other repository thread', 'C:\\work\\other-repository', now);

  const overview = getOverview({ codexHome: root, now, limit: 6 });

  assert.equal(overview.tasks.length, 3);
  assert.deepEqual(new Set(overview.tasks.map((task) => task.title)), new Set([
    'Newest pet companion thread',
    'Other repository thread',
    'Build task context overlay',
  ]));
  assert.equal(overview.tasks[0].title, 'Newest pet companion thread');
  assert.equal(overview.agents.active, 3);
});
