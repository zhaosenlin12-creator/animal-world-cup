// One-time prep for building on Windows without SeCreateSymbolicLinkPrivilege:
// 1) Create a 7za.bat shim that excludes the darwin/ symlinks inside winCodeSign
//    (Windows can't create them, which makes electron-builder's extraction fail).
// 2) Seed a dedicated electron-builder cache with winCodeSign via that shim.
// Both are idempotent.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(PACK, "..");
const WS = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules";
const SHIM_BIN = path.join(ROOT, ".pack-bin");
const CACHE = path.join(ROOT, ".pack-cache");
const REAL7Z = path.join(WS, "7zip-bin", "win", "x64", "7za.exe");
const AB = path.join(WS, "app-builder-bin", "win", "x64", "app-builder.exe");

// --- 1) shim ---
fs.mkdirSync(SHIM_BIN, { recursive: true });
const shim =
  "@echo off\r\n" +
  "setlocal\r\n" +
  `"${REAL7Z}" %* -xr!darwin\r\n` +
  "exit /b %ERRORLEVEL%\r\n";
fs.writeFileSync(path.join(SHIM_BIN, "7za.bat"), shim);
console.log("[prepare] 7za shim ready");

// --- 2) seed winCodeSign cache ---
// app-builder stores it at Cache/winCodeSign/winCodeSign-2.6.0/
const signDir = path.join(CACHE, "winCodeSign", "winCodeSign-2.6.0");
if (!fs.existsSync(path.join(signDir, "rcedit-x64.exe"))) {
  fs.mkdirSync(CACHE, { recursive: true });
  const env = {
    ...process.env,
    PATH: SHIM_BIN + ";C:/Program Files/nodejs;" + (process.env.PATH || ""),
    ELECTRON_BUILDER_CACHE: CACHE,
    ELECTRON_BUILDER_BINARIES_MIRROR: "https://npmmirror.com/mirrors/electron-builder-binaries/",
  };
  const res = spawnSync(AB, ["download-artifact", "--name", "winCodeSign"], {
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  if (res.status !== 0) {
    console.error("[prepare] winCodeSign seed failed:", (res.stderr || "").slice(-500));
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(signDir, "rcedit-x64.exe"))) {
  console.error("[prepare] rcedit missing after seed");
  process.exit(1);
}
console.log("[prepare] winCodeSign cache ready at", signDir);
console.log("[prepare] DONE");
