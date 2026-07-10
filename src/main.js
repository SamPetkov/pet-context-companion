const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const {
  getCodexHome,
  getOverview,
  mapPetAnchorToDisplay,
  readPetState,
} = require('./codex-data');
const { RateLimitService } = require('./rate-limits');

let overlayWindow = null;
let updateTimer = null;
let anchorRefreshTimer = null;
let petStatePath = null;
let lastAnchorKey = null;
let lastPetStateKey = null;
let latestOverview = null;
const rateLimitService = new RateLimitService();
const OVERLAY_SIZE = { width: 860, height: 640 };
const PET_STATE_POLL_MS = 75;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildOverview() {
  const overview = getOverview({ limit: 6 });
  return {
    ...overview,
    quotas: rateLimitService.snapshot,
  };
}

function petStateKey(pet) {
  const anchor = pet?.anchor;
  const display = pet?.displayBounds;
  return anchor
    ? `${pet.overlayOpen}:${anchor.x}:${anchor.y}:${anchor.width}:${anchor.height}:${pet.displayId ?? ''}:${display?.x ?? ''}:${display?.y ?? ''}:${display?.width ?? ''}:${display?.height ?? ''}`
    : `${pet?.overlayOpen}:none`;
}

function normalizedDisplayId(displayId) {
  const numericId = Number(displayId);
  return Number.isFinite(numericId) ? numericId >>> 0 : null;
}

function displayForPet(pet) {
  const displays = screen.getAllDisplays();
  const petDisplayId = normalizedDisplayId(pet?.displayId);
  if (petDisplayId !== null) {
    const matchingDisplay = displays.find((display) => normalizedDisplayId(display.id) === petDisplayId);
    if (matchingDisplay) {
      return matchingDisplay;
    }
  }

  const source = pet?.displayBounds;
  if (source) {
    const matchingDisplay = displays.find((display) => (
      Math.abs((display.bounds.width * display.scaleFactor) - source.width) < 2
      && Math.abs((display.bounds.height * display.scaleFactor) - source.height) < 2
    ));
    if (matchingDisplay) {
      return matchingDisplay;
    }
  }

  const anchor = pet?.anchor;
  const rawCenter = anchor
    ? { x: anchor.x + (anchor.width / 2), y: anchor.y + (anchor.height / 2) }
    : screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(rawCenter);
}

function positionOverlay(window, overview, force = false) {
  const display = displayForPet(overview.pet);
  const anchorCenter = mapPetAnchorToDisplay(overview.pet, display);
  const { workArea } = display;
  const maxX = workArea.x + workArea.width - OVERLAY_SIZE.width - 8;
  const maxY = workArea.y + workArea.height - OVERLAY_SIZE.height - 8;
  const cloudSide = anchorCenter && anchorCenter.x - workArea.x > (workArea.x + workArea.width) - anchorCenter.x
    ? 'left'
    : 'right';
  const targetPet = { x: cloudSide === 'left' ? 670 : 190, y: 300 };
  const anchorKey = anchorCenter ? `${anchorCenter.x}:${anchorCenter.y}:${cloudSide}` : 'fallback';

  let x = maxX;
  let y = maxY - 32;
  if (anchorCenter) {
    x = clamp(
      anchorCenter.x - targetPet.x,
      workArea.x + 8,
      maxX,
    );
    y = clamp(anchorCenter.y - targetPet.y, workArea.y + 8, maxY);
  }

  if (force || anchorKey !== lastAnchorKey) {
    window.setPosition(x, y);
    lastAnchorKey = anchorKey;
  }

  return {
    cloudSide,
    pet: anchorCenter
      ? { x: Math.round(anchorCenter.x - x), y: Math.round(anchorCenter.y - y) }
      : targetPet,
  };
}

function broadcastOverview(forcePosition = false) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const overview = buildOverview();
  overview.layout = positionOverlay(overlayWindow, overview, forcePosition);
  latestOverview = overview;
  lastPetStateKey = petStateKey(overview.pet);
  overlayWindow.webContents.send('companion:overview', overview);
  rateLimitService.refresh().then((updated) => {
    if (updated) {
      broadcastOverview();
    }
  });
}

function refreshPetAnchor() {
  anchorRefreshTimer = null;
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const pet = readPetState(getCodexHome());
  const nextPetStateKey = petStateKey(pet);
  if (latestOverview && nextPetStateKey === lastPetStateKey) {
    return;
  }

  const overview = latestOverview
    ? { ...latestOverview, pet }
    : buildOverview();
  overview.layout = positionOverlay(overlayWindow, overview);
  latestOverview = overview;
  lastPetStateKey = nextPetStateKey;
  overlayWindow.webContents.send('companion:overview', overview);
}

function schedulePetAnchorRefresh() {
  clearTimeout(anchorRefreshTimer);
  anchorRefreshTimer = setTimeout(refreshPetAnchor, PET_STATE_POLL_MS);
}

function watchPetAnchor() {
  petStatePath = path.join(getCodexHome(), '.codex-global-state.json');
  fs.watchFile(petStatePath, { interval: PET_STATE_POLL_MS }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
      schedulePetAnchorRefresh();
    }
  });
}

function stopWatchingPetAnchor() {
  if (petStatePath) {
    fs.unwatchFile(petStatePath);
    petStatePath = null;
  }
  clearTimeout(anchorRefreshTimer);
  anchorRefreshTimer = null;
}

function captureTestScreenshot() {
  const destination = process.env.PET_COMPANION_SCREENSHOT;
  if (!destination || !overlayWindow) {
    return;
  }

  const delay = Number(process.env.PET_COMPANION_SCREENSHOT_DELAY_MS) || 1_200;
  setTimeout(async () => {
    try {
      const screenshotView = process.env.PET_COMPANION_SCREENSHOT_VIEW;
      if (screenshotView === 'grid' || screenshotView === 'minimized') {
        await overlayWindow.webContents.executeJavaScript("document.querySelector('#view-toggle')?.click()");
      }
      if (screenshotView === 'minimized') {
        await overlayWindow.webContents.executeJavaScript("document.querySelector('#view-toggle')?.click()");
      }
      if (screenshotView === 'grid' || screenshotView === 'minimized') {
        await new Promise((resolve) => setTimeout(resolve, 480));
      }
      const image = await overlayWindow.webContents.capturePage();
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.writeFile(destination, image.toPNG());
      app.quit();
    } catch (error) {
      console.error('Unable to capture companion screenshot:', error);
      app.exit(1);
    }
  }, delay);
}

function createOverlay() {
  overlayWindow = new BrowserWindow({
    width: OVERLAY_SIZE.width,
    height: OVERLAY_SIZE.height,
    minWidth: OVERLAY_SIZE.width,
    minHeight: OVERLAY_SIZE.height,
    maxWidth: OVERLAY_SIZE.width,
    maxHeight: OVERLAY_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
    broadcastOverview(true);
    captureTestScreenshot();
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createOverlay();
    updateTimer = setInterval(() => broadcastOverview(), 8_000);
    watchPetAnchor();
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (!overlayWindow) {
        createOverlay();
        return;
      }
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
      } else {
        overlayWindow.showInactive();
        overlayWindow.webContents.send('companion:restore');
        broadcastOverview(true);
      }
    });
    globalShortcut.register('CommandOrControl+Shift+V', () => {
      overlayWindow?.webContents.send('companion:voice-toggle');
    });
  });

  app.on('second-instance', () => {
    if (!overlayWindow) {
      createOverlay();
      return;
    }
    overlayWindow.showInactive();
    overlayWindow.webContents.send('companion:restore');
    broadcastOverview(true);
  });
}

ipcMain.handle('companion:overview', () => {
  const overview = buildOverview();
  overview.layout = overlayWindow ? positionOverlay(overlayWindow, overview) : null;
  return overview;
});
ipcMain.handle('companion:hide', () => overlayWindow?.hide());
ipcMain.handle('companion:open-task', (_event, threadId) => {
  if (typeof threadId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) {
    return false;
  }
  return shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`).then(() => true);
});
ipcMain.on('companion:set-ignore-mouse-events', (event, ignore) => {
  if (typeof ignore !== 'boolean') {
    return;
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(updateTimer);
  stopWatchingPetAnchor();
});

app.on('activate', () => {
  if (!overlayWindow) {
    createOverlay();
  }
});
