const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  parseAction,
  resolveInstallDir,
} = require('../plugins/pet-context-companion/scripts/install-and-launch');

test('plugin launcher accepts named and flag actions', () => {
  assert.equal(parseAction([]), 'start');
  assert.equal(parseAction(['--install']), 'install');
  assert.equal(parseAction(['update']), 'update');
  assert.throws(() => parseAction(['--remove']), /Unknown action/);
});

test('plugin launcher uses the platform application-data location', () => {
  assert.equal(
    resolveInstallDir({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      home: 'C:\\Users\\Ada',
    }),
    path.join('C:\\Users\\Ada\\AppData\\Local', 'PetContextCompanion', 'app'),
  );

  assert.equal(
    resolveInstallDir({ platform: 'darwin', env: {}, home: '/Users/ada' }),
    path.join('/Users/ada', 'Library', 'Application Support', 'PetContextCompanion', 'app'),
  );

  assert.equal(
    resolveInstallDir({ platform: 'linux', env: {}, home: '/home/ada' }),
    path.join('/home/ada', '.local', 'share', 'pet-context-companion', 'app'),
  );
});

test('plugin launcher honors an explicit install location', () => {
  assert.equal(
    resolveInstallDir({
      platform: 'linux',
      env: { PET_CONTEXT_COMPANION_HOME: './custom-companion' },
      home: '/home/ada',
    }),
    path.resolve('./custom-companion'),
  );
});
