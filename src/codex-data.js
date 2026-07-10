const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONTEXT_HOME = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
const MAX_SESSION_FILES = 96;
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

function getCodexHome(environment = process.env) {
  return environment.CODEX_HOME || DEFAULT_CONTEXT_HOME;
}

function asNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = asNumber(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function parseJsonLines(content) {
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readTail(filePath, maxBytes = 768 * 1024) {
  const fileSize = fs.statSync(filePath).size;
  const start = Math.max(0, fileSize - maxBytes);
  const length = fileSize - start;
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, 'r');

  try {
    fs.readSync(descriptor, buffer, 0, length, start);
  } finally {
    fs.closeSync(descriptor);
  }

  const text = buffer.toString('utf8');
  return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
}

function readHead(filePath, maxBytes = 64 * 1024) {
  const fileSize = fs.statSync(filePath).size;
  const length = Math.min(fileSize, maxBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, 'r');

  try {
    fs.readSync(descriptor, buffer, 0, length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  return buffer.toString('utf8');
}

function findSessionId(filePath) {
  const matches = path.basename(filePath).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi);
  return matches ? matches.at(-1) : null;
}

function readSessionIndex(codexHome) {
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  const index = new Map();

  if (!fs.existsSync(indexPath)) {
    return index;
  }

  for (const entry of parseJsonLines(readTail(indexPath, 2 * 1024 * 1024))) {
    if (typeof entry.id === 'string') {
      index.set(entry.id, {
        threadName: typeof entry.thread_name === 'string' ? entry.thread_name : null,
        updatedAt: entry.updated_at || null,
      });
    }
  }

  return index;
}

function listSessionFiles(sessionRoot, limit = MAX_SESSION_FILES) {
  const files = [];
  const pending = [sessionRoot];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory || !fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  return files
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    .slice(0, limit);
}

function visitObjects(value, visitor, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) {
    return;
  }

  visitor(value);
  for (const child of Object.values(value)) {
    visitObjects(child, visitor, depth + 1);
  }
}

function updateTelemetry(snapshot, candidate) {
  const payload = candidate.payload && typeof candidate.payload === 'object'
    ? candidate.payload
    : candidate;
  const info = payload.info && typeof payload.info === 'object' ? payload.info : payload;
  const latestUsage = info.last_token_usage || payload.last_token_usage;
  const totalUsage = info.total_token_usage || payload.total_token_usage;
  const contextWindow = firstNumber(
    info.model_context_window,
    payload.model_context_window,
    payload.context_window,
    candidate.model_context_window,
  );

  if (!latestUsage && !totalUsage && contextWindow === null) {
    return;
  }

  snapshot.contextWindow = contextWindow ?? snapshot.contextWindow;
  if (latestUsage && typeof latestUsage === 'object') {
    snapshot.contextUsed = firstNumber(
      latestUsage.total_tokens,
      latestUsage.totalTokens,
      snapshot.contextUsed,
    );
  }
  if (totalUsage && typeof totalUsage === 'object') {
    snapshot.inputTokens = firstNumber(totalUsage.input_tokens, totalUsage.inputTokens, snapshot.inputTokens);
    snapshot.outputTokens = firstNumber(totalUsage.output_tokens, totalUsage.outputTokens, snapshot.outputTokens);
  }
}

function readSessionMeta(filePath) {
  const metadata = {};
  const records = parseJsonLines(readHead(filePath));

  for (const record of records) {
    if (record.type !== 'session_meta') {
      continue;
    }
    const payload = record.payload || record;
    metadata.id = typeof payload.id === 'string' ? payload.id : metadata.id;
    metadata.cwd = typeof payload.cwd === 'string' ? payload.cwd : metadata.cwd;
    metadata.threadName = typeof payload.thread_name === 'string' ? payload.thread_name : metadata.threadName;
  }

  return metadata;
}

function workspaceName(cwd) {
  if (!cwd) {
    return null;
  }
  return /^[A-Za-z]:[\\/]/.test(cwd)
    ? path.win32.basename(path.win32.normalize(cwd))
    : path.basename(path.normalize(cwd));
}

function workspaceKey(cwd) {
  if (!cwd) {
    return null;
  }
  const normalized = /^[A-Za-z]:[\\/]/.test(cwd)
    ? path.win32.normalize(cwd)
    : path.normalize(cwd);
  const withoutTrailingSeparator = normalized.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}

function readTaskFromSession(file, sessionIndex, now = Date.now()) {
  const metadata = readSessionMeta(file.filePath);
  const sessionId = metadata.id || findSessionId(file.filePath);
  const indexEntry = sessionId ? sessionIndex.get(sessionId) : null;
  const telemetry = {
    contextWindow: null,
    contextUsed: null,
    inputTokens: null,
    outputTokens: null,
  };

  for (const record of parseJsonLines(readTail(file.filePath))) {
    visitObjects(record, (candidate) => updateTelemetry(telemetry, candidate));
  }

  const workspace = workspaceName(metadata.cwd);
  const contextPercent = telemetry.contextWindow && telemetry.contextUsed !== null
    ? Math.max(0, Math.min(100, Math.round((telemetry.contextUsed / telemetry.contextWindow) * 100)))
    : null;
  const title = indexEntry?.threadName || metadata.threadName || workspace || `Task ${sessionId?.slice(-6) || 'unknown'}`;

  return {
    id: sessionId || file.filePath,
    title,
    workspace,
    workspacePath: metadata.cwd || null,
    updatedAt: file.stat.mtimeMs,
    status: now - file.stat.mtimeMs < ACTIVE_WINDOW_MS ? 'working' : 'idle',
    context: {
      used: telemetry.contextUsed,
      window: telemetry.contextWindow,
      percent: contextPercent,
    },
    tokens: {
      input: telemetry.inputTokens,
      output: telemetry.outputTokens,
    },
  };
}

function readPetState(codexHome) {
  const statePath = path.join(codexHome, '.codex-global-state.json');
  if (!fs.existsSync(statePath)) {
    return { overlayOpen: false };
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const bounds = state['electron-avatar-overlay-bounds'];
    const anchor = bounds?.anchor;
    const hasAnchor = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y);
    const displayBounds = bounds?.displayBounds;
    const hasDisplayBounds = Number.isFinite(displayBounds?.x)
      && Number.isFinite(displayBounds?.y)
      && Number.isFinite(displayBounds?.width)
      && Number.isFinite(displayBounds?.height)
      && displayBounds.width > 0
      && displayBounds.height > 0;
    const pet = {
      overlayOpen: state['electron-avatar-overlay-open'] === true,
      anchor: hasAnchor ? { x: anchor.x, y: anchor.y, width: anchor.width || 0, height: anchor.height || 0 } : null,
    };
    if (hasDisplayBounds) {
      pet.displayBounds = {
        x: displayBounds.x,
        y: displayBounds.y,
        width: displayBounds.width,
        height: displayBounds.height,
      };
    }
    if (bounds?.displayId !== undefined && bounds?.displayId !== null) {
      pet.displayId = bounds.displayId;
    }
    return pet;
  } catch {
    return { overlayOpen: false, anchor: null };
  }
}

function mapPetAnchorToDisplay(pet, display) {
  const anchor = pet?.anchor;
  if (!anchor) {
    return null;
  }

  const rawCenter = {
    x: anchor.x + (anchor.width / 2),
    y: anchor.y + (anchor.height / 2),
  };
  const source = pet.displayBounds;
  const target = display?.bounds;
  if (!source || !target || source.width <= 0 || source.height <= 0) {
    return rawCenter;
  }

  return {
    x: target.x + ((rawCenter.x - source.x) * (target.width / source.width)),
    y: target.y + ((rawCenter.y - source.y) * (target.height / source.height)),
  };
}

function selectLatestWorkspaces(files, limit) {
  const selected = [];
  const seenWorkspaces = new Set();

  for (const file of files) {
    const metadata = readSessionMeta(file.filePath);
    const key = workspaceKey(metadata.cwd) || metadata.id || findSessionId(file.filePath) || file.filePath;
    if (seenWorkspaces.has(key)) {
      continue;
    }

    seenWorkspaces.add(key);
    selected.push(file);
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}

function getOverview({ codexHome = getCodexHome(), now = Date.now(), limit = 6 } = {}) {
  const sessionIndex = readSessionIndex(codexHome);
  const tasks = selectLatestWorkspaces(
    listSessionFiles(path.join(codexHome, 'sessions')),
    limit,
  )
    .map((file) => readTaskFromSession(file, sessionIndex, now))
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    generatedAt: now,
    pet: readPetState(codexHome),
    agents: {
      active: tasks.filter((task) => task.status === 'working').length,
    },
    tasks,
  };
}

module.exports = {
  ACTIVE_WINDOW_MS,
  findSessionId,
  getCodexHome,
  getOverview,
  mapPetAnchorToDisplay,
  parseJsonLines,
  readPetState,
  readSessionIndex,
  readTaskFromSession,
  selectLatestWorkspaces,
  workspaceKey,
  workspaceName,
};
