// Run electron-builder to produce the NSIS installer + portable exe.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(PACK, "..");
const APP = path.join(PACK, "app");
const NODE = process.execPath;
const WS = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules";
const BUILDER = path.join(WS, "electron-builder", "out", "cli", "cli.js");
const ELECTRON_DIST = path.join(WS, "electron", "dist");
// .pack-bin/7za.bat excludes the useless darwin symlinks from winCodeSign that
// Windows cannot create without admin privileges; placed first on PATH so
// app-builder's `exec("7za")` picks it up.
const SHIM_BIN = path.join(ROOT, ".pack-bin");
// Dedicated cache pre-seeded by build-pack-tools.mjs via the same shim.
const BUILDER_CACHE = path.join(ROOT, ".pack-cache");

const env = {
  ...process.env,
  PATH: SHIM_BIN + ";C:/Program Files/nodejs;" + (process.env.PATH || ""),
  ELECTRON_BUILDER_CACHE: BUILDER_CACHE,
  // Point electron-builder at the already-downloaded Electron binary.
  ELECTRON_OVERRIDE_DIST_PATH: ELECTRON_DIST,
  ELECTRON_MIRROR: "https://npmmirror.com/mirrors/electron/",
  // NSIS / winCodeSign helpers download from this mirror.
  ELECTRON_BUILDER_BINARIES_MIRROR: "https://npmmirror.com/mirrors/electron-builder-binaries/",
  npm_config_registry: "https://registry.npmmirror.com",
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

// Regenerate the multi-size .ico from the lion avatar before packaging.
const iconCode = await new Promise((resolve) => {
  const p = spawn(NODE, [path.join(PACK, "make-icon.mjs")], { cwd: ROOT, stdio: "inherit" });
  p.on("exit", (c) => resolve(c ?? 0));
  p.on("error", () => resolve(1));
});
if (iconCode !== 0) {
  console.error("[package] make-icon failed");
  process.exit(1);
}

console.log("[package] building NSIS installer + portable exe ...");
const code = await new Promise((resolve) => {
  const p = spawn(NODE, [BUILDER, "--win", "--x64", "--publish", "never"], {
    cwd: APP,
    env,
    stdio: "inherit",
  });
  p.on("exit", (c) => resolve(c ?? 0));
  p.on("error", (e) => { console.error(e); resolve(1); });
});
if (code !== 0) {
  console.error("[package] electron-builder failed with code", code);
  process.exit(1);
}
console.log("[package] DONE");
