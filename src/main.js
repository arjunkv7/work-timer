const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Data storage ──────────────────────────────────────────────────────────────
const DATA_FILE = path.join(os.homedir(), '.worktimer.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { sessions: {}, lastPromptDate: null };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTimeISO(ts) {
  return new Date(ts).toISOString();
}

// ── App state ─────────────────────────────────────────────────────────────────
let tray = null;
let mainWindow = null;
let data = loadData();
let running = false;
let sessionStart = null;
let tickInterval = null;
let autoSaveInterval = null;

function getTodaySession() {
  const key = todayKey();
  if (!data.sessions[key]) data.sessions[key] = { seconds: 0, skipped: false, startTime: null, endTime: null, breaks: [] };
  return data.sessions[key];
}

function getTodaySecs() {
  const s = getTodaySession();
  if (s.skipped) return 0;
  return s.seconds || 0;
}

function addSecsToday(secs) {
  const s = getTodaySession();
  s.seconds = (s.seconds || 0) + secs;
  saveData(data);
}

function getLiveSecs() {
  if (!running || !sessionStart) return 0;
  return Math.floor((Date.now() - sessionStart) / 1000);
}

function getTodayTotal() {
  return getTodaySecs() + getLiveSecs();
}

// ── Timer control ─────────────────────────────────────────────────────────────
function startTimer() {
  if (running) return;
  running = true;
  sessionStart = Date.now();

  const s = getTodaySession();

  // Record start time (first start of the day only)
  if (!s.startTime) {
    s.startTime = fmtTimeISO(sessionStart);
    saveData(data);
  }

  // Close any open break
  if (s.breaks && s.breaks.length > 0) {
    const lastBreak = s.breaks[s.breaks.length - 1];
    if (lastBreak && !lastBreak.end) {
      lastBreak.end = fmtTimeISO(sessionStart);
      lastBreak.secs = Math.floor((sessionStart - new Date(lastBreak.start).getTime()) / 1000);
      saveData(data);
    }
  }

  let lastTickDay = todayKey();
  tickInterval = setInterval(() => {
    // Reset day prompt flag at midnight
    const currentDay = todayKey();
    if (currentDay !== lastTickDay) {
      lastTickDay = currentDay;
      dayPromptShown = null;
      pendingDayPrompt = false;
    }
    broadcastState();
    updateTrayTooltip();
  }, 1000);

  autoSaveInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    if (elapsed > 0) {
      addSecsToday(elapsed);
      sessionStart = Date.now();
    }
  }, 60000);

  broadcastState();
  updateTray();
}

function pauseTimer(reason) {
  if (!running) return;
  running = false;
  const pausedAt = Date.now();
  const elapsed = Math.floor((pausedAt - sessionStart) / 1000);
  sessionStart = null;
  clearInterval(tickInterval);
  clearInterval(autoSaveInterval);
  tickInterval = null;
  autoSaveInterval = null;

  if (elapsed > 0) addSecsToday(elapsed);

  // Record break start and update end time
  const s = getTodaySession();
  if (!s.breaks) s.breaks = [];
  s.breaks.push({ start: fmtTimeISO(pausedAt), end: null, secs: 0 });
  s.endTime = fmtTimeISO(pausedAt);
  saveData(data);

  broadcastState();
  updateTray();

  if (reason === 'lock') {
    showNotification('WorkTimer paused', 'Screen locked — timer stopped.');
  }
}

function stopForDay() {
  if (running) pauseTimer();

  const s = getTodaySession();
  s.stoppedForDay = true;
  if (!s.endTime) s.endTime = fmtTimeISO(Date.now());
  saveData(data);

  broadcastState();
  updateTray();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('show-day-summary');
  }
}

function resetToday() {
  if (running) {
    running = false;
    clearInterval(tickInterval);
    clearInterval(autoSaveInterval);
    tickInterval = null;
    autoSaveInterval = null;
    sessionStart = null;
  }
  const key = todayKey();
  data.sessions[key] = { seconds: 0, skipped: false, startTime: null, endTime: null, breaks: [] };
  saveData(data);
  broadcastState();
  updateTray();
}

let lockDebounce = null;

function handleLock() {
  if (lockDebounce) return;
  lockDebounce = setTimeout(() => { lockDebounce = null; }, 2000);
  if (running) pauseTimer('lock');
}

let unlockDebounce = null;

function handleUnlock() {
  if (unlockDebounce) return;
  unlockDebounce = setTimeout(() => { unlockDebounce = null; }, 5000);

  if (running) return;

  const key = todayKey();
  const s = data.sessions[key];

  // Day was skipped or stopped for today — do nothing
  if (s && (s.skipped || s.stoppedForDay)) return;

  // Timer has been running today — just resume it
  if (s && (s.seconds > 0 || s.startTime)) {
    data.lastPromptDate = key;
    dayPromptShown = key;
    saveData(data);
    startTimer();
    showNotification('WorkTimer resumed', 'Screen unlocked — timer started.');
    return;
  }

  // New day, no session yet — show the daily prompt
  checkDayPrompt();
}

// ── D-Bus screen lock detection ───────────────────────────────────────────────
async function setupScreenLockDetection() {
  const platform = process.platform;

  if (platform === 'linux') {
    await setupDBus();
  } else if (platform === 'darwin') {
    // macOS — poll ioreg every 3s
    const { execSync } = require('child_process');
    let wasLocked = false;
    setInterval(() => {
      try {
        const out = execSync('ioreg -n Root -d1 -a | grep -c CGSSessionScreenIsLocked', { timeout: 2000 }).toString().trim();
        const isLocked = parseInt(out) > 0;
        if (isLocked && !wasLocked) handleLock();
        if (!isLocked && wasLocked) handleUnlock();
        wasLocked = isLocked;
      } catch (e) {}
    }, 3000);
    console.log('✓ macOS screen lock detection active (ioreg polling)');
  } else if (platform === 'win32') {
    // Windows — Electron powerMonitor (native, instant)
    try {
      const { powerMonitor } = require('electron');
      powerMonitor.on('lock-screen', () => handleLock());
      powerMonitor.on('unlock-screen', () => handleUnlock());
      console.log('✓ Windows screen lock detection active (powerMonitor)');
    } catch (e) {
      console.warn('Windows screen lock detection failed:', e.message);
    }
  }
}

async function setupDBus() {
  try {
    const dbus = require('dbus-next');
    const sessionBus = dbus.sessionBus();

    // systemd-logind: Lock/Unlock signals fire only on actual screen lock, not idle screensaver
    try {
      const sessionId = process.env.XDG_SESSION_ID;
      if (!sessionId) throw new Error('XDG_SESSION_ID not set');
      const loginObj = await sessionBus.getProxyObject('org.freedesktop.login1', '/org/freedesktop/login1');
      const manager = loginObj.getInterface('org.freedesktop.login1.Manager');
      const sessionPath = await manager.GetSession(sessionId);
      const sessionObj = await sessionBus.getProxyObject('org.freedesktop.login1', sessionPath);
      const sessionIface = sessionObj.getInterface('org.freedesktop.login1.Session');
      sessionIface.on('Lock', () => handleLock());
      sessionIface.on('Unlock', () => handleUnlock());
      console.log('✓ systemd-logind screen lock detection active');
      return;
    } catch (e) {
      console.log('systemd-logind not available, trying GNOME ScreenSaver…');
    }

    // GNOME ScreenSaver: ActiveChanged fires when the GNOME lock screen appears
    try {
      const obj = await sessionBus.getProxyObject('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver');
      const iface = obj.getInterface('org.gnome.ScreenSaver');
      iface.on('ActiveChanged', (active) => {
        if (active) handleLock();
        else handleUnlock();
      });
      console.log('✓ GNOME ScreenSaver D-Bus connected');
      return;
    } catch (e) {
      console.log('GNOME ScreenSaver not available…');
    }

    console.warn('No reliable screen lock interface found. Timer will not auto-pause on lock.');
  } catch (e) {
    console.error('D-Bus setup failed:', e.message);
  }
}

// ── Day prompt ────────────────────────────────────────────────────────────────
let dayPromptShown = null;
let pendingDayPrompt = false;

function checkDayPrompt() {
  const key = todayKey();
  if (data.lastPromptDate === key) return;
  if (dayPromptShown === key) return;
  if (pendingDayPrompt) return;
  const s = data.sessions[key];
  if (s && s.skipped) return;
  if (s && s.seconds > 0) {
    data.lastPromptDate = key;
    saveData(data);
    return;
  }
  dayPromptShown = key;
  pendingDayPrompt = true;
  sendDayPrompt();
}

function sendDayPrompt() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // Window doesn't exist yet — create it and send prompt after did-finish-load
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => {
      pendingDayPrompt = false;
      mainWindow.webContents.send('show-day-prompt');
    });
  } else {
    pendingDayPrompt = false;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('show-day-prompt');
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-state', () => buildState());
ipcMain.on('timer-start', () => startTimer());
ipcMain.on('timer-pause', () => pauseTimer());
ipcMain.on('timer-reset', () => resetToday());
ipcMain.on('timer-stop-day', () => stopForDay());
ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-hide', () => { if (mainWindow) mainWindow.hide(); });

ipcMain.on('day-accept', () => {
  const key = todayKey();
  // Only create a fresh session if one doesn't already exist
  if (!data.sessions[key]) {
    data.sessions[key] = { seconds: 0, skipped: false, startTime: null, endTime: null, breaks: [] };
  } else {
    // Never overwrite existing data — just unmark skipped if needed
    data.sessions[key].skipped = false;
  }
  data.lastPromptDate = key;
  dayPromptShown = key;
  saveData(data);
  startTimer();
  broadcastState();
});

ipcMain.on('day-skip', () => {
  const key = todayKey();
  data.sessions[key] = { seconds: 0, skipped: true, startTime: null, endTime: null, breaks: [] };
  data.lastPromptDate = key;
  saveData(data);
  broadcastState();
});

// ── State builder ─────────────────────────────────────────────────────────────
function buildState() {
  const key = todayKey();
  const todayTotal = getTodayTotal();
  const s = getTodaySession();

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  let weekSecs = 0, allSecs = 0;
  Object.entries(data.sessions).forEach(([k, sess]) => {
    if (!sess || sess.skipped) return;
    const secs = k === key ? todayTotal : (sess.seconds || 0);
    allSecs += secs;
    const [y, m, d] = k.split('-').map(Number);
    if (new Date(y, m - 1, d) >= weekStart) weekSecs += secs;
  });

  // Break calculations
  const breaks = s.breaks || [];
  const completedBreaks = breaks.filter(b => b.end);
  const totalBreakSecs = completedBreaks.reduce((sum, b) => sum + (b.secs || 0), 0);
  const onBreakNow = !running && breaks.length > 0 && !breaks[breaks.length - 1].end;
  const liveBreakSecs = onBreakNow
    ? Math.floor((Date.now() - new Date(breaks[breaks.length - 1].start).getTime()) / 1000)
    : 0;

  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 4);
  cutoff.setHours(0, 0, 0, 0);

  const recent = Object.entries(data.sessions)
    .sort(([a], [b]) => b.localeCompare(a))
    .filter(([k]) => {
      const [y, m, d] = k.split('-').map(Number);
      return new Date(y, m - 1, d) >= cutoff;
    })
    .map(([k, sess]) => ({
      key: k,
      seconds: k === key ? todayTotal : (sess.seconds || 0),
      skipped: sess.skipped || false,
      startTime: sess.startTime || null,
      endTime: k === key ? (running ? fmtTimeISO(Date.now()) : sess.endTime) : sess.endTime,
      breakCount: (sess.breaks || []).filter(b => b.end).length + (k === key && onBreakNow ? 1 : 0),
      totalBreakSecs: (sess.breaks || []).filter(b => b.end).reduce((sum, b) => sum + (b.secs || 0), 0) + (k === key ? liveBreakSecs : 0)
    }));

  return {
    running,
    todayTotal,
    weekSecs,
    allSecs,
    recent,
    todayKey: key,
    lastPromptDate: data.lastPromptDate,
    startTime: s.startTime || null,
    endTime: running ? fmtTimeISO(Date.now()) : (s.endTime || null),
    breakCount: completedBreaks.length + (onBreakNow ? 1 : 0),
    totalBreakSecs: totalBreakSecs + liveBreakSecs,
    stoppedForDay: s.stoppedForDay || false,
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', buildState());
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function buildTrayIcon(active) {
  const color = active ? '#22c55e' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="none" stroke="${color}" stroke-width="1.5"/>
    <line x1="8" y1="8" x2="8" y2="3.5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="8" y1="8" x2="11" y2="9.5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="8" cy="8" r="1" fill="${color}"/>
  </svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function updateTrayTooltip() {
  if (!tray) return;
  const total = getTodayTotal();
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  tray.setToolTip(`WorkTimer — ${running ? '▶' : '⏸'} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
}

function updateTray() {
  if (!tray) return;
  tray.setImage(buildTrayIcon(running));
  updateTrayTooltip();
  const todaySession = getTodaySession();
  const contextMenu = Menu.buildFromTemplate([
    { label: running ? '⏸  Pause' : '▶  Start', click: () => running ? pauseTimer() : startTimer(), enabled: !todaySession.stoppedForDay },
    { label: '⏹  Stop for today', click: () => stopForDay(), enabled: !todaySession.stoppedForDay && (running || getTodaySecs() > 0) },
    { label: '🪟  Open', click: showWindow },
    { type: 'separator' },
    { label: '↺  Reset today', click: resetToday },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

// ── Window ────────────────────────────────────────────────────────────────────
let windowCreating = false;

function createWindow() {
  if (windowCreating) return;
  windowCreating = true;

  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    resizable: false,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    skipTaskbar: false,
    title: 'WorkTimer'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.once('ready-to-show', () => {
    windowCreating = false;
    mainWindow.show();
  });
}

function showWindow() {
  if (windowCreating) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else { mainWindow.show(); mainWindow.focus(); }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  showWindow();
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.worktimer.app');

  const key = todayKey();
  const s = data.sessions[key];
  if (s && !s.skipped && (s.seconds > 0 || s.startTime)) {
    data.lastPromptDate = key;
    saveData(data);
    dayPromptShown = key;
  }

  tray = new Tray(buildTrayIcon(false));
  tray.setToolTip('WorkTimer');
  tray.on('activate', showWindow);
  tray.on('click', showWindow);

  updateTray();
  createWindow();
  await setupScreenLockDetection();

  if (s && (s.skipped || s.stoppedForDay)) {
    // Day was skipped or stopped for today — do nothing
  } else if (s && (s.seconds > 0 || s.startTime)) {
    // Session exists — resume timer regardless of lastPromptDate
    startTimer();
  } else {
    // New day — show prompt
    checkDayPrompt();
  }

  app.on('before-quit', () => {
    if (running) {
      const now = Date.now();
      const elapsed = Math.floor((now - sessionStart) / 1000);
      if (elapsed > 0) addSecsToday(elapsed);
      const s = getTodaySession();
      s.endTime = fmtTimeISO(now);
      saveData(data);
    }
  });
});

app.on('window-all-closed', (e) => { e.preventDefault(); });