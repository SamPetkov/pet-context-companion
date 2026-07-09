const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { getOverview } = require('./codex-data');

let overlayWindow = null;
let updateTimer = null;

function positionOverlay(window) {
  const overview = getOverview();
  const anchor = overview.pet?.anchor;
  const display = screen.getDisplayNearestPoint(anchor || screen.getCursorScreenPoint());
  const { workArea } = display;
  const bounds = window.getBounds();
  const maxX = workArea.x + workArea.width - bounds.width - 10;
  const maxY = workArea.y + workArea.height - bounds.height - 10;

  if (anchor) {
    const x = Math.max(workArea.x + 10, Math.min(maxX, anchor.x - bounds.width - 14));
    const y = Math.max(workArea.y + 10, Math.min(maxY, anchor.y - Math.round(bounds.height / 2)));
    window.setPosition(x, y);
    return;
  }

  window.setPosition(maxX, maxY - 64);
}

function broadcastOverview() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send('companion:overview', getOverview());
}

function captureTestScreenshot() {
  const destination = process.env.PET_COMPANION_SCREENSHOT;
  if (!destination || !overlayWindow) {
    return;
  }

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
  }, 900);
}

function createOverlay() {
  overlayWindow = new BrowserWindow({
    width: 356,
    height: 230,
    minWidth: 356,
    minHeight: 230,
    maxWidth: 356,
    maxHeight: 230,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlayWindow.once('ready-to-show', () => {
    positionOverlay(overlayWindow);
    overlayWindow.showInactive();
    broadcastOverview();
    captureTestScreenshot();
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  createOverlay();
  updateTimer = setInterval(broadcastOverview, 8_000);
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (!overlayWindow) {
      createOverlay();
      return;
    }
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
      broadcastOverview();
    }
  });
});

ipcMain.handle('companion:overview', () => getOverview());
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
