#!/usr/bin/env node

"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "pet-context-companion";
const REPOSITORY_URL = "https://github.com/SamPetkov/pet-context-companion.git";
const TRUSTED_REPOSITORY_URL = "https://github.com/sampetkov/pet-context-companion";
const DEFAULT_BRANCH = "main";
const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org/";
const SUPPORTED_ACTIONS = new Set(["check", "install", "start", "update"]);
const INSTALL_ENVIRONMENT_BLOCKLIST = new Set([
  "ELECTRON_CUSTOM_DIR",
  "ELECTRON_CUSTOM_VERSION",
  "ELECTRON_MIRROR",
  "ELECTRON_OVERRIDE_DIST_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "electron_config_cache",
  "force_no_cache",
  "npm_config_ca",
  "npm_config_cafile",
  "npm_config_electron_mirror",
  "npm_config_electron_use_remote_checksums",
  "npm_config_node_options",
  "npm_config_registry",
  "npm_config_strict_ssl",
]);
const LAUNCH_ENVIRONMENT_BLOCKLIST = new Set([
  "ELECTRON_OVERRIDE_DIST_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "PET_COMPANION_SCREENSHOT",
  "PET_COMPANION_SCREENSHOT_DELAY_MS",
  "PET_COMPANION_SCREENSHOT_VIEW",
]);
const GIT_ENVIRONMENT_BLOCKLIST = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSL_NO_VERIFY",
  "GIT_WORK_TREE",
]);

function resolveInstallDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (env.PET_CONTEXT_COMPANION_HOME) {
    return path.resolve(env.PET_CONTEXT_COMPANION_HOME);
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(localAppData, "PetContextCompanion", "app");
  }

  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "PetContextCompanion", "app");
  }

  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(dataHome, APP_NAME, "app");
}

function parseAction(argv) {
  const raw = argv[0] || "start";
  const action = raw.replace(/^--/, "");
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error(`Unknown action "${raw}". Use --install, --start, --update, or --check.`);
  }
  return action;
}

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function commandInvocation(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    return {
      command: systemRoot ? path.join(systemRoot, "System32", "cmd.exe") : "cmd.exe",
      args: ["/d", "/s", "/c", [command, ...args].join(" ")],
    };
  }
  return { command, args };
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
  return result;
}

function runOutput(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
  return result.stdout.trim();
}

function commandVersion(command, args = ["--version"]) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readInstalledPackage(installDir) {
  const packagePath = path.join(installDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return manifest.name === APP_NAME ? manifest : null;
  } catch {
    return null;
  }
}

function dependenciesReady(installDir) {
  try {
    return Boolean(electronExecutable(installDir));
  } catch {
    return false;
  }
}

function isSupportedNodeVersion(version = process.versions.node) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\./);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}

function ensureNodeVersion() {
  if (!isSupportedNodeVersion()) {
    throw new Error(`Node.js 22.12 or newer is required. Current version: ${process.version}.`);
  }
}

function normalizeRepositoryUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function isTrustedRepositoryUrl(value) {
  return normalizeRepositoryUrl(value) === TRUSTED_REPOSITORY_URL;
}

function sanitizedEnvironment(baseEnvironment = process.env, blocklist = INSTALL_ENVIRONMENT_BLOCKLIST) {
  const environment = { ...baseEnvironment };
  const blockedNames = new Set([...blocklist].map((key) => key.toUpperCase()));
  for (const key of blocklist) {
    blockedNames.add(key.toUpperCase());
  }
  for (const key of Object.keys(environment)) {
    if (blockedNames.has(key.toUpperCase())) {
      delete environment[key];
    }
  }
  return environment;
}

function installationEnvironment(baseEnvironment = process.env) {
  const environment = sanitizedEnvironment(baseEnvironment);
  environment.npm_config_registry = OFFICIAL_NPM_REGISTRY;
  environment.npm_config_strict_ssl = "true";
  return environment;
}

function launchEnvironment(baseEnvironment = process.env) {
  return sanitizedEnvironment(baseEnvironment, LAUNCH_ENVIRONMENT_BLOCKLIST);
}

function gitEnvironment(baseEnvironment = process.env) {
  return sanitizedEnvironment(baseEnvironment, GIT_ENVIRONMENT_BLOCKLIST);
}

function checkoutStatus(installDir) {
  if (!fs.existsSync(path.join(installDir, ".git"))) {
    return {
      isGitCheckout: false,
      trustedOrigin: false,
      branch: null,
      workingTreeClean: false,
    };
  }

  try {
    const environment = gitEnvironment();
    const origin = runOutput("git", ["-C", installDir, "remote", "get-url", "origin"], { env: environment });
    const branch = runOutput("git", ["-C", installDir, "branch", "--show-current"], { env: environment });
    const changes = runOutput("git", ["-C", installDir, "status", "--porcelain", "--untracked-files=no"], { env: environment });
    return {
      isGitCheckout: true,
      trustedOrigin: isTrustedRepositoryUrl(origin),
      branch,
      workingTreeClean: changes.length === 0,
    };
  } catch {
    return {
      isGitCheckout: true,
      trustedOrigin: false,
      branch: null,
      workingTreeClean: false,
    };
  }
}

function assertTrustedCheckout(installDir) {
  const status = checkoutStatus(installDir);
  if (!status.isGitCheckout) {
    throw new Error(`The installation is not a Git checkout: ${installDir}`);
  }
  if (!status.trustedOrigin) {
    throw new Error("The installation origin is not the official Pet Context Companion repository.");
  }
  if (status.branch !== DEFAULT_BRANCH) {
    throw new Error(`The installation must be on the ${DEFAULT_BRANCH} branch before it can run.`);
  }
  if (!status.workingTreeClean) {
    throw new Error("The installation has modified tracked files. Reinstall from the official repository before running it.");
  }
}

function ensureCommand(command, label) {
  if (!commandVersion(command)) {
    throw new Error(`${label} is required but was not found on PATH.`);
  }
}

function cloneApplication(installDir) {
  const parent = path.dirname(installDir);
  fs.mkdirSync(parent, { recursive: true });

  if (fs.existsSync(installDir) && fs.readdirSync(installDir).length > 0) {
    throw new Error(
      `The install folder exists but is not a Pet Context Companion checkout: ${installDir}`,
    );
  }

  run("git", ["clone", "--depth", "1", "--branch", DEFAULT_BRANCH, "--single-branch", REPOSITORY_URL, installDir], {
    env: gitEnvironment(),
  });
}

function updateApplication(installDir) {
  assertTrustedCheckout(installDir);
  const environment = gitEnvironment();
  const shallow = runOutput("git", ["-C", installDir, "rev-parse", "--is-shallow-repository"], { env: environment }) === "true";
  const fetchArgs = ["-C", installDir, "fetch", "--no-tags"];
  if (shallow) {
    fetchArgs.push("--unshallow");
  }
  fetchArgs.push("origin", DEFAULT_BRANCH);
  run("git", fetchArgs, { env: environment });
  run("git", ["-C", installDir, "merge", "--ff-only", "FETCH_HEAD"], { env: environment });
}

function installDependencies(installDir) {
  if (!fs.existsSync(path.join(installDir, "package-lock.json"))) {
    throw new Error("The installation is missing package-lock.json, so dependency integrity cannot be verified.");
  }
  const npm = executable("npm");
  const environment = installationEnvironment();
  run(npm, ["ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund", `--registry=${OFFICIAL_NPM_REGISTRY}`, "--strict-ssl=true"], {
    cwd: installDir,
    env: environment,
  });

  const electronInstaller = path.join(installDir, "node_modules", "electron", "install.js");
  if (!fs.existsSync(electronInstaller)) {
    throw new Error("Electron's verified installer was not installed from the lockfile.");
  }
  run(process.execPath, [electronInstaller], { cwd: installDir, env: environment });
}

function electronExecutable(installDir) {
  const electronEntry = require.resolve("electron", { paths: [installDir] });
  const binary = require(electronEntry);
  if (typeof binary !== "string" || !fs.existsSync(binary)) {
    throw new Error("Electron is installed but its desktop executable could not be found.");
  }
  return binary;
}

function launchApplication(installDir) {
  const child = spawn(electronExecutable(installDir), ["."], {
    cwd: installDir,
    detached: true,
    env: launchEnvironment(),
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function installationStatus(installDir) {
  const manifest = readInstalledPackage(installDir);
  const checkout = checkoutStatus(installDir);
  return {
    installDir,
    installed: Boolean(manifest),
    version: manifest?.version || null,
    dependenciesReady: dependenciesReady(installDir),
    node: process.version,
    git: commandVersion("git"),
    npm: commandVersion(executable("npm")),
    lockfilePresent: fs.existsSync(path.join(installDir, "package-lock.json")),
    trustedOrigin: checkout.trustedOrigin,
    branch: checkout.branch,
    workingTreeClean: checkout.workingTreeClean,
  };
}

function main(argv = process.argv.slice(2)) {
  const action = parseAction(argv);
  const installDir = resolveInstallDir();

  if (action === "check") {
    console.log(JSON.stringify(installationStatus(installDir), null, 2));
    return;
  }

  ensureNodeVersion();
  ensureCommand("git", "Git");
  let manifest = readInstalledPackage(installDir);
  if (!manifest) {
    cloneApplication(installDir);
    manifest = readInstalledPackage(installDir);
    if (!manifest) {
      throw new Error(`The official repository did not contain a ${APP_NAME} package.`);
    }
  } else if (action === "update") {
    updateApplication(installDir);
  }

  assertTrustedCheckout(installDir);

  if (action === "install" || action === "update" || !dependenciesReady(installDir)) {
    ensureCommand(executable("npm"), "npm");
    installDependencies(installDir);
  }

  launchApplication(installDir);
  const verb = action === "update" ? "updated and started" : "started";
  console.log(`Pet Context Companion ${verb} from ${installDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Pet Context Companion: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  checkoutStatus,
  gitEnvironment,
  installationEnvironment,
  isSupportedNodeVersion,
  isTrustedRepositoryUrl,
  launchEnvironment,
  installationStatus,
  parseAction,
  resolveInstallDir,
};
