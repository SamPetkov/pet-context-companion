const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  installationEnvironment,
  gitEnvironment,
  isSupportedNodeVersion,
  isTrustedRepositoryUrl,
  launchEnvironment,
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

test('plugin launcher accepts only the official repository origin', () => {
  assert.equal(isTrustedRepositoryUrl('https://github.com/SamPetkov/pet-context-companion.git'), true);
  assert.equal(isTrustedRepositoryUrl('git@github.com:SamPetkov/pet-context-companion.git'), false);
  assert.equal(isTrustedRepositoryUrl('https://github.com/SamPetkov/pet-context-companion-malware.git'), false);
  assert.equal(isTrustedRepositoryUrl('https://example.com/SamPetkov/pet-context-companion.git'), false);
});

test('plugin launcher requires a supported Node.js runtime', () => {
  assert.equal(isSupportedNodeVersion('v22.12.0'), true);
  assert.equal(isSupportedNodeVersion('v22.11.9'), false);
  assert.equal(isSupportedNodeVersion('v20.19.0'), false);
  assert.equal(isSupportedNodeVersion('v24.0.0'), true);
});

test('plugin launcher clears executable and registry overrides from child environments', () => {
  const environment = {
    CODEX_HOME: '/safe/codex-home',
    ELECTRON_MIRROR: 'https://example.com/electron',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--require ./unexpected.js',
    PET_COMPANION_SCREENSHOT: '/tmp/screenshot.png',
    npm_config_registry: 'https://example.com/registry',
  };

  const installation = installationEnvironment(environment);
  assert.equal(installation.CODEX_HOME, '/safe/codex-home');
  assert.equal(installation.ELECTRON_MIRROR, undefined);
  assert.equal(installation.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(installation.NODE_OPTIONS, undefined);
  assert.equal(installation.npm_config_registry, 'https://registry.npmjs.org/');

  const launch = launchEnvironment(environment);
  assert.equal(launch.CODEX_HOME, '/safe/codex-home');
  assert.equal(launch.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.NODE_OPTIONS, undefined);
  assert.equal(launch.PET_COMPANION_SCREENSHOT, undefined);

  const git = gitEnvironment({
    GIT_CONFIG_GLOBAL: '/tmp/override',
    GIT_SSH_COMMAND: 'unexpected-command',
    git_ssl_no_verify: 'true',
    PATH: '/safe/path',
  });
  assert.equal(git.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(git.GIT_SSH_COMMAND, undefined);
  assert.equal(git.git_ssl_no_verify, undefined);
  assert.equal(git.PATH, '/safe/path');
});
