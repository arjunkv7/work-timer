# WorkTimer

A desktop work time tracker that lives in your system tray. Automatically tracks how long you work each day, pauses when your screen locks, and keeps a history of sessions with start/end times and break durations.

---

## Features

- ⏱ Auto-starts timer when you open the app
- 🔒 Pauses automatically on screen lock, resumes on unlock
- ☀️ Daily prompt to start or skip each new day
- 💾 Saves every 60 seconds — no data lost on crash or force-quit
- 📊 Tracks start time, end time, break count and total break duration
- 🗓 Session history with weekly and all-time totals
- 🖥 Lives in the system tray — always running in the background

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)

Check your versions:
```bash
node --version
npm --version
```

---

## Installation

```bash
# 1. Extract the project folder
# 2. Open a terminal inside it
cd worktimer

# 3. Install dependencies
npm install

# 4. Start the app
npm start
```

On **Linux**, add `-- --no-sandbox` if you see a sandbox error:
```bash
npm start -- --no-sandbox
```

Or update `package.json` to make it permanent:
```json
"start": "electron . --no-sandbox"
```

---

## Platform Setup

---

### 🐧 Linux (Ubuntu / GNOME)

#### Screen lock detection
Works automatically via D-Bus (`org.gnome.ScreenSaver`). No extra setup needed on Ubuntu with GNOME.

If D-Bus is unavailable, install the fallback idle detector:
```bash
sudo apt install xprintidle
```

#### Create a launcher script
```bash
cat > ~/path/to/worktimer/start.sh << 'EOF'
#!/bin/bash
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin"
cd "$(dirname "$0")"
$(which npm) start -- --no-sandbox
EOF
chmod +x ~/path/to/worktimer/start.sh
```

Replace `~/path/to/worktimer` with your actual project path. Run `pwd` inside the folder to find it.

#### Pin to sidebar (GNOME Dock)
```bash
# Create a desktop entry
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/worktimer.desktop << EOF
[Desktop Entry]
Type=Application
Name=WorkTimer
Comment=Track your work hours
Exec=/home/$(whoami)/path/to/worktimer/start.sh
Icon=clock
Terminal=false
Categories=Utility;
StartupWMClass=worktimer
EOF

# Refresh app list
update-desktop-database ~/.local/share/applications
```

Then:
1. Press **Super** key to open Activities
2. Search **WorkTimer**
3. Right-click the icon → **Pin to Dash**

#### Auto-start on login
```bash
mkdir -p ~/.config/autostart
cp ~/.local/share/applications/worktimer.desktop ~/.config/autostart/worktimer.desktop
```

---

### 🍎 macOS

#### Screen lock detection
Uses `ioreg` polling every 3 seconds — no extra setup needed. Detection triggers within ~3 seconds of screen lock/unlock.

#### Create a launcher script
```bash
cat > ~/path/to/worktimer/start.sh << 'EOF'
#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")"
npm start
EOF
chmod +x ~/path/to/worktimer/start.sh
```

#### Pin to Dock
1. Run `npm start` once to launch the app
2. Right-click the app icon in the Dock
3. Select **Options → Keep in Dock**

#### Auto-start on login
Create a Launch Agent:
```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.worktimer.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.worktimer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/YOUR_USERNAME/path/to/worktimer/start.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

# Load it immediately
launchctl load ~/Library/LaunchAgents/com.worktimer.plist
```

Replace `YOUR_USERNAME` and the path with your actual values.

Alternatively, go to **System Settings → General → Login Items** and add the `start.sh` script there.

---

### 🪟 Windows

#### Screen lock detection
Works automatically via Electron's built-in `powerMonitor` — instant detection, no extra setup needed.

#### Create a launcher script
Create a file called `start.bat` in the project folder:
```bat
@echo off
cd /d "%~dp0"
npm start
```

#### Pin to Taskbar
1. Right-click `start.bat` → **Create shortcut**
2. Right-click the shortcut → **Properties**
3. Change the icon if desired → **OK**
4. Right-click the shortcut → **Pin to taskbar**

Or launch the app first, then right-click the taskbar icon → **Pin to taskbar**.

#### Auto-start on login

**Option 1 — Startup folder (simplest):**
```
Win + R → shell:startup → Enter
```
Copy your `start.bat` shortcut into that folder.

**Option 2 — Task Scheduler:**
1. Open **Task Scheduler**
2. Click **Create Basic Task**
3. Name it `WorkTimer`
4. Trigger: **When I log on**
5. Action: **Start a program** → browse to `start.bat`
6. Finish

---

## Data Storage

All session data is saved to a JSON file in your home directory:

| Platform | Path |
|----------|------|
| Linux | `~/.worktimer.json` |
| macOS | `~/.worktimer.json` |
| Windows | `C:\Users\YOUR_USERNAME\.worktimer.json` |

Example data format:
```json
{
  "sessions": {
    "2026-05-13": {
      "seconds": 21600,
      "skipped": false,
      "startTime": "2026-05-13T09:01:00.000Z",
      "endTime": "2026-05-13T18:05:00.000Z",
      "breaks": [
        { "start": "2026-05-13T12:00:00.000Z", "end": "2026-05-13T13:00:00.000Z", "secs": 3600 },
        { "start": "2026-05-13T15:30:00.000Z", "end": "2026-05-13T15:45:00.000Z", "secs": 900 }
      ]
    },
    "2026-05-12": {
      "seconds": 0,
      "skipped": true
    }
  },
  "lastPromptDate": "2026-05-13"
}
```

---

## Tray Icon

Right-click the tray icon for quick controls:

| Action | Description |
|--------|-------------|
| ▶ Start / ⏸ Pause | Toggle the timer |
| 🪟 Open | Show the main window |
| ⏹ Reset today | Clear today's session |
| Quit | Exit the app completely |

The icon turns **green** when the timer is running and **gray** when paused.

---

## Restarting the App

After updating the code, kill any running instance before relaunching so the new code takes effect.

**Linux / macOS**
```bash
pkill -f "worktimer/node_modules/electron"
```
Then start normally (`npm start` or click the launcher).

**Windows**
```bat
taskkill /IM electron.exe /F
```
Then run `start.bat` or `npm start`.

> Only one instance can run at a time. If you launch the app while it's already running, the existing window will be focused instead of opening a second copy.

---

## Troubleshooting

**App doesn't start from sidebar/taskbar**
Run `start.sh` (or `start.bat`) directly from the terminal to see the error output.

**Screen lock not detected on Linux**
Check D-Bus is running: `echo $DBUS_SESSION_BUS_ADDRESS`
If empty, install xprintidle as a fallback: `sudo apt install xprintidle`

**Timer doesn't resume after unlock on macOS**
macOS detection polls every 3 seconds — there may be a brief delay. If it never resumes, check that Node.js is in your PATH inside `start.sh`.

**`dbus-next` errors on Windows/macOS**
This is safe to ignore — `dbus-next` is only used on Linux and is not loaded on other platforms.