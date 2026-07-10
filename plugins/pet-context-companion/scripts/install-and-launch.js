#!/usr/bin/env node

"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "pet-context-companion";
const REPOSITORY_URL = "https://github.com/SamPetkov/pet-context-companion.git";
const SUPPORTED_ACTIONS = new Set(["check", "install", "start", "update"]);

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
    return {
      command: process.env.ComSpec || "cmd.exe",
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
  return fs.existsSync(path.join(installDir, "node_modules", "electron", "package.json"));
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node.js 20 or newer is required. Current version: ${process.version}.`);
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

  run("git", ["clone", "--depth", "1", REPOSITORY_URL, installDir]);
}

function updateApplication(installDir) {
  if (!fs.existsSync(path.join(installDir, ".git"))) {
    throw new Error(`Cannot update because the installation is not a Git checkout: ${installDir}`);
  }
  run("git", ["-C", installDir, "pull", "--ff-only"]);
}

function installDependencies(installDir) {
  const npm = executable("npm");
  const command = fs.existsSync(path.join(installDir, "package-lock.json")) ? "ci" : "install";
  run(npm, [command, "--include=dev", "--no-audit", "--no-fund"], { cwd: installDir });
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
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function installationStatus(installDir) {
  const manifest = readInstalledPackage(installDir);
  return {
    installDir,
    installed: Boolean(manifest),
    version: manifest?.version || null,
    dependenciesReady: dependenciesReady(installDir),
    node: process.version,
    git: commandVersion("git"),
    npm: commandVersion(executable("npm")),
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
  let manifest = readInstalledPackage(installDir);
  if (!manifest) {
    ensureCommand("git", "Git");
    cloneApplication(installDir);
    manifest = readInstalledPackage(installDir);
  } else if (action === "update") {
    ensureCommand("git", "Git");
    updateApplication(installDir);
  }

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
  installationStatus,
  parseAction,
  resolveInstallDir,
};
