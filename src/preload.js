const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worktimer', {
  getState: () => ipcRenderer.invoke('get-state'),
  start: () => ipcRenderer.send('timer-start'),
  pause: () => ipcRenderer.send('timer-pause'),
  reset: () => ipcRenderer.send('timer-reset'),
  stopDay: () => ipcRenderer.send('timer-stop-day'),
  acceptDay: () => ipcRenderer.send('day-accept'),
  skipDay: () => ipcRenderer.send('day-skip'),
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_e, state) => cb(state)),
  onShowDayPrompt: (cb) => ipcRenderer.on('show-day-prompt', () => cb()),
  onShowDaySummary: (cb) => ipcRenderer.on('show-day-summary', () => cb()),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-hide'),
});