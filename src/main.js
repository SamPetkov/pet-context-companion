const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { getOverview } = require('./codex-data');
const { RateLimitService } = require('./rate-limits');

let overlayWindow = null;
let updateTimer = null;
let lastAnchorKey = null;
const rateLimitService = new RateLimitService();
const OVERLAY_SIZE = { width: 860, height: 640 };

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

function positionOverlay(window, overview, force = false) {
  const anchor = overview.pet?.anchor;
  const anchorCenter = anchor
    ? { x: anchor.x + (anchor.width / 2), y: anchor.y + (anchor.height / 2) }
    : null;
  const display = screen.getDisplayNearestPoint(anchorCenter || screen.getCursorScreenPoint());
  const { workArea } = display;
  const maxX = workArea.x + workArea.width - OVERLAY_SIZE.width - 8;
  const maxY = workArea.y + workArea.height - OVERLAY_SIZE.height - 8;
  const cloudSide = anchorCenter && anchorCenter.x - workArea.x > (workArea.x + workArea.width) - anchorCenter.x
    ? 'left'
    : 'right';
  const anchorKey = anchorCenter ? `${anchorCenter.x}:${anchorCenter.y}:${cloudSide}` : 'fallback';

  let x = maxX;
  let y = maxY - 32;
  if (anchorCenter) {
    x = clamp(
      anchorCenter.x - (cloudSide === 'left' ? 680 : 180),
      workArea.x + 8,
      maxX,
    );
    y = clamp(anchorCenter.y - 310, workArea.y + 8, maxY);
  }

  if (force || anchorKey !== lastAnchorKey) {
    window.setPosition(x, y);
    lastAnchorKey = anchorKey;
  }

  return {
    cloudSide,
    pet: anchorCenter
      ? { x: Math.round(anchorCenter.x - x), y: Math.round(anchorCenter.y - y) }
      : { x: cloudSide === 'left' ? 670 : 190, y: 300 },
  };
}

function broadcastOverview(forcePosition = false) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const overview = buildOverview();
  overview.layout = positionOverlay(overlayWindow, overview, forcePosition);
  overlayWindow.webContents.send('companion:overview', overview);
  rateLimitService.refresh().then((updated) => {
    if (updated) {
      broadcastOverview();
    }
  });
}

function captureTestScreenshot() {
  const destination = process.env.PET_COMPANION_SCREENSHOT;
  if (!destination || !overlayWindow) {
    return;
  }

  const delay = Number(process.env.PET_COMPANION_SCREENSHOT_DELAY_MS) || 1_200;
  setTimeout(async () => {
    try {
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

app.whenReady().then(() => {
  createOverlay();
  updateTimer = setInterval(() => broadcastOverview(), 8_000);
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (!overlayWindow) {
      createOverlay();
      return;
    }
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
      broadcastOverview(true);
    }
  });
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    overlayWindow?.webContents.send('companion:voice-toggle');
  });
});

ipcMain.handle('companion:overview', () => {
  const overview = buildOverview();
  overview.layout = overlayWindow ? positionOverlay(overlayWindow, overview) : null;
  return overview;
});
ipcMain.handle('companion:hide', () => overlayWindow?.hide());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(updateTimer);
});

app.on('activate', () => {
  if (!overlayWindow) {
    createOverlay();
  }
});
