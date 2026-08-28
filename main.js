const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');
const SignalingServer = require('./server');

let mainWindow = null;
let signalingServer = null;
let selectedSourceForCapture = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1200, width - 100),
    height: Math.min(800, height - 100),
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false
  });

  // THE STEALTH MAGIC: Makes the window invisible to screen capture
  mainWindow.setContentProtection(true);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready to avoid flicker
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function startSignalingServer(port = 8085, retries = 5) {
  return new Promise((resolve) => {
    try {
      signalingServer = new SignalingServer(port);
      const wss = signalingServer.start();

      // The WebSocket server emits 'error' asynchronously for port conflicts
      wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && retries > 0) {
          console.log(`[Main] Port ${port} in use, trying ${port + 1}...`);
          signalingServer.stop();
          startSignalingServer(port + 1, retries - 1).then(resolve);
        } else {
          console.error('[Main] Signaling server error:', err.message);
          resolve(port); // Continue without server
        }
      });

      wss.on('listening', () => {
        console.log(`[Main] Signaling server started on port ${port}`);
        resolve(port);
      });
    } catch (err) {
      console.error('[Main] Failed to start signaling server:', err.message);
      resolve(port);
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Handle modern getDisplayMedia requests
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const selected = sources.find(s => s.id === selectedSourceForCapture);
      if (selected) {
        callback({ video: selected });
      } else {
        callback({ video: sources[0] }); // Fallback to first screen
      }
      selectedSourceForCapture = null; // Reset
    }).catch(err => {
      console.error('[Main] getDisplayMedia error:', err);
    });
  });

  await startSignalingServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (signalingServer) {
    signalingServer.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Always on top
ipcMain.on('toggle-always-on-top', () => {
  if (mainWindow) {
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current, 'floating');
    mainWindow.webContents.send('always-on-top-changed', !current);
  }
});

ipcMain.handle('get-always-on-top', () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false;
});

// Content protection toggle (for debugging)
ipcMain.on('toggle-content-protection', (event, enabled) => {
  if (mainWindow) {
    mainWindow.setContentProtection(enabled);
    console.log(`[Main] Content protection: ${enabled ? 'ON' : 'OFF'}`);
  }
});

// Desktop capturer - get available screen sources
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: null,
      display_id: source.display_id
    }));
  } catch (err) {
    console.error('[Main] Failed to get sources:', err);
    return [];
  }
});

// Set selected source for getDisplayMedia
ipcMain.on('set-selected-source', (event, sourceId) => {
  selectedSourceForCapture = sourceId;
});

// Window maximize state change listener
if (mainWindow) {
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-changed', false);
  });
}
