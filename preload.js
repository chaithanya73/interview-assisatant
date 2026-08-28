const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Always on top
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on('always-on-top-changed', (event, value) => callback(value));
  },

  // Content protection
  toggleContentProtection: (enabled) => ipcRenderer.send('toggle-content-protection', enabled),

  // Desktop capturer
  getSources: () => ipcRenderer.invoke('get-sources'),

  // Maximize state listener
  onMaximizeChanged: (callback) => {
    ipcRenderer.on('maximize-changed', (event, isMaximized) => callback(isMaximized));
  }
});
