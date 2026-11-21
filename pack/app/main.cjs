// Animal Cup desktop shell.
// Boots the self-contained Next.js server plus the LAN and local-room relays,
// then shows a window pointed at the local server. All child processes use the
// Electron binary itself as the Node runtime (ELECTRON_RUN_AS_NODE), so no
// external Node installation is required on the player's machine.
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

const isPackaged = app.isPackaged;
// Build uses asar:false, so packaged files live in resources/app/ as real
// files (needed for child Node processes to load .next/native modules).
// Fall back to app.asar.unpacked for compatibility, and __dirname in dev.
function resolveAppRoot() {
  if (!isPackaged) return __dirname;
  const plain = path.join(process.resourcesPath, "app");
  if (fs.existsSync(path.join(plain, "server", "server.js"))) return plain;
  return path.join(process.resourcesPath, "app.asar.unpacked");
}
const appRoot = resolveAppRoot();
const serverDir = path.join(appRoot, "server");
const relayDir = path.join(appRoot, "relay");

const PORT = 13000;
const children = [];
let mainWindow = null;
let starting = false;

function log(...args) {
  console.log("[animal-cup]", ...args);
}

function runNode(script, args, name, cwd, extraEnv = {}) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    ...extraEnv,
  };
  const p = spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}] `;
  const pipe = (stream, out) =>
    stream.on("data", (b) => {
      const text = String(b).trimEnd();
      if (text) out.write(prefix + text + "\n");
    });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code, sig) => {
    log(`${name} exited code=${code} sig=${sig}`);
  });
  p.on("error", (err) => log(`${name} spawn error`, err.message));
  children.push(p);
  return p;
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      const done = (ok) => {
        socket.destroy();
        if (ok) return resolve();
        if (Date.now() > deadline) return reject(new Error(`port ${port} not ready`));
        setTimeout(attempt, 300);
      };
      socket.setTimeout(1000);
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      socket.once("timeout", () => done(false));
    };
    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "动物足球 — AI 动物足球模拟器",
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Injects window.__desktop=true so the game forces keyboard mode
      // (Electron reports maxTouchPoints>0 even on a mouse+keyboard PC).
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function start() {
  if (starting) return;
  starting = true;

  // Sanity: make sure embedded payload exists before booting.
  const serverJs = path.join(serverDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    dialog.showErrorBox("动物足球", `缺少内置服务文件：\n${serverJs}`);
    app.quit();
    return;
  }

  log("starting embedded services from", appRoot);

  // 1) Self-contained Next.js production server on 13000.
  // Bind 0.0.0.0 so phones on the same Wi-Fi can reach /pad via the LAN IP.
  // NODE_PATH points to the renamed dependency dir (electron-builder drops
  // folders literally named node_modules).
  runNode(serverJs, [], "next", serverDir, {
    PORT: String(PORT),
    HOSTNAME: "0.0.0.0",
    NODE_PATH: path.join(serverDir, "deps"),
  });

  // 2) LAN gamepad relay on 13001 (phones on same Wi-Fi).
  const relayNodePath = path.join(relayDir, "wsdeps");
  const lanRelay = path.join(relayDir, "lan-server.mjs");
  if (fs.existsSync(lanRelay)) runNode(lanRelay, [], "lan", appRoot, { NODE_PATH: relayNodePath });

  // 3) Local public-room relay on 13002 (two-screen / invite rooms).
  const onlineRelay = path.join(relayDir, "online-server.mjs");
  if (fs.existsSync(onlineRelay)) {
    runNode(onlineRelay, [], "online", appRoot, { NODE_PATH: relayNodePath });
  }

  try {
    await waitForPort(PORT, "127.0.0.1", 30000);
    log("server ready, opening window");
    if (!mainWindow) createWindow();
  } catch (err) {
    dialog.showErrorBox("动物足球", `本地服务启动超时：\n${err.message}`);
    app.quit();
  }
}

function stopChildren() {
  for (const p of children) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  children.length = 0;
}

// Single instance: focus existing window instead of launching a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start);
}

app.on("window-all-closed", () => {
  stopChildren();
  app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", stopChildren);
