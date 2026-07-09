const { spawn } = require('node:child_process');

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function unavailableRateLimits(status = 'unavailable') {
  return {
    status,
    primary: null,
    secondary: null,
    resetCredits: null,
    plan: null,
  };
}

function normalizeWindow(window) {
  if (!window || !Number.isFinite(window.usedPercent)) {
    return null;
  }

  return {
    usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
    windowDurationMins: Number.isFinite(window.windowDurationMins) ? window.windowDurationMins : null,
    resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
  };
}

function normalizeRateLimitSnapshot(result) {
  const limits = result?.rateLimits || {};
  return {
    status: 'available',
    primary: normalizeWindow(limits.primary),
    secondary: normalizeWindow(limits.secondary),
    resetCredits: Number.isInteger(result?.rateLimitResetCredits?.availableCount)
      ? result.rateLimitResetCredits.availableCount
      : null,
    plan: typeof limits.planType === 'string' ? limits.planType : null,
  };
}

function codexCommand() {
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function readRateLimitSnapshot({ spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lineBuffer = '';
    let initialized = false;
    const child = spawnImpl(codexCommand(), ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    const send = (id, method, params) => {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, new Error('Codex rate-limit request timed out.'));
    }, timeoutMs);

    child.on('error', (error) => finish(reject, error));
    child.stderr.on('data', () => {});
    child.on('close', (code) => {
      if (!settled) {
        finish(reject, new Error(`Codex app-server stopped before returning rate limits (exit ${code}).`));
      }
    });
    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      let lineEnd = lineBuffer.indexOf('\n');
      while (lineEnd >= 0) {
        const line = lineBuffer.slice(0, lineEnd);
        lineBuffer = lineBuffer.slice(lineEnd + 1);
        lineEnd = lineBuffer.indexOf('\n');

        try {
          const message = JSON.parse(line);
          if (message.id === 1 && !initialized) {
            initialized = true;
            if (message.error) {
              child.stdin.end();
              finish(reject, new Error('Codex app-server initialization failed.'));
            } else {
              send(2, 'account/rateLimits/read', {});
            }
          }
          if (message.id === 2) {
            child.stdin.end();
            if (message.error) {
              finish(reject, new Error('Codex did not return account rate limits.'));
            } else {
              finish(resolve, normalizeRateLimitSnapshot(message.result));
            }
          }
        } catch {
          // App-server diagnostics are emitted on stderr; ignore malformed stdout fragments.
        }
      }
    });

    send(1, 'initialize', {
      clientInfo: {
        name: 'pet-context-companion',
        version: '0.2.0',
      },
      capabilities: {},
    });
  });
}

class RateLimitService {
  constructor({ refreshMs = DEFAULT_REFRESH_MS, read = readRateLimitSnapshot } = {}) {
    this.refreshMs = refreshMs;
    this.read = read;
    this.snapshot = unavailableRateLimits('loading');
    this.lastAttemptAt = 0;
    this.inFlight = null;
  }

  refresh() {
    const now = Date.now();
    if (this.inFlight || now - this.lastAttemptAt < this.refreshMs) {
      return this.inFlight || Promise.resolve(false);
    }

    this.lastAttemptAt = now;
    this.inFlight = this.read()
      .then((snapshot) => {
        this.snapshot = snapshot;
        return true;
      })
      .catch(() => {
        if (this.snapshot.status === 'loading') {
          this.snapshot = unavailableRateLimits();
          return true;
        }
        return false;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}

module.exports = {
  RateLimitService,
  normalizeRateLimitSnapshot,
  readRateLimitSnapshot,
  unavailableRateLimits,
};
