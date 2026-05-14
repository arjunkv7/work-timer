const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worktimer', {
  getState: () => ipcRenderer.invoke('get-state'),
  start: () => ipcRenderer.send('timer-start'),
  pause: () => ipcRenderer.send('timer-pause'),
  reset: () => ipcRenderer.send('timer-reset'),
  acceptDay: () => ipcRenderer.send('day-accept'),
  skipDay: () => ipcRenderer.send('day-skip'),
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_e, state) => cb(state)),
  onShowDayPrompt: (cb) => ipcRenderer.on('show-day-prompt', () => cb()),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-hide'),
});