// Assemble the Electron payload from the standalone Next build + LAN/online
// relays. Produces pack/app/{server,relay,online} ready for electron-builder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(PACK, "..");
const APP = path.join(PACK, "app");
const SERVER = path.join(APP, "server");
const RELAY = path.join(APP, "relay");
const ONLINE = path.join(APP, "online");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dst, filter) {
  if (!fs.existsSync(src)) throw new Error(`missing source: ${src}`);
  fs.mkdirSync(dst, { recursive: true });
  // dereference: pnpm's node_modules are symlinks; copy the real files so the
  // payload is self-contained and cpSync doesn't try to recreate symlinks.
  fs.cpSync(src, dst, { recursive: true, force: true, dereference: true, filter });
}
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// --- 1) Next standalone server ---
const standalone = path.join(ROOT, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("standalone build missing — run pack-build.mjs first");
}
// Always refresh the server payload from the latest standalone build. copyDir
// uses force:true so it overwrites in place; no bulk delete needed (the shell
// guards large rmSync calls). node_modules -> deps rename is idempotent.
// Skip the standalone node_modules: we keep a stable `deps` dir instead
// (renamed once below), and re-copying it would recreate a node_modules we
// can't cheaply remove under the shell's bulk-delete guard.
copyDir(standalone, SERVER, (src) => !src.split(/[\\/]/).includes("node_modules"));
// standalone omits public/ and .next/static/ by design; add them back.
copyDir(path.join(ROOT, "public"), path.join(SERVER, "public"));
copyDir(path.join(ROOT, ".next", "static"), path.join(SERVER, ".next", "static"));
// Rename nested node_modules -> deps so electron-builder's dependency
// scanner doesn't drop it; main.cjs injects it via NODE_PATH. Idempotent.
const nm = path.join(SERVER, "node_modules");
const deps = path.join(SERVER, "deps");
if (fs.existsSync(nm) && !fs.existsSync(deps)) fs.renameSync(nm, deps);
console.log("[assemble] server payload ready");

// --- 2) Relays (LAN + local public rooms) ---
rmrf(RELAY);
fs.mkdirSync(RELAY, { recursive: true });
// ESM `import` ignores NODE_PATH, so rewrite the bare "ws" import to a
// relative path into the relocated dependency (see wsdeps below).
function copyRelay(name) {
  const src = path.join(ROOT, "script", name);
  let code = fs.readFileSync(src, "utf8");
  code = code.replace(/from\s+["']ws["']/g, 'from "./wsdeps/ws/wrapper.mjs"');
  fs.writeFileSync(path.join(RELAY, name), code);
}
copyRelay("lan-server.mjs");
copyRelay("online-server.mjs");
// online-server.mjs imports "../online/shared.js" relative to script/.
// Keep the same relative layout: relay/online-server.mjs -> app/online/shared.js
rmrf(ONLINE);
fs.mkdirSync(ONLINE, { recursive: true });
copyFile(path.join(ROOT, "online", "shared.js"), path.join(ONLINE, "shared.js"));
// Electron's Node 20 treats shared.js as CJS without this marker; the relay
// scripts use named ESM imports from it, so scope ESM to the online/ dir only.
fs.writeFileSync(
  path.join(ONLINE, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);
// ws has no dependencies; place it where Node's resolver finds it from relay/.
// node_modules/ws is a pnpm symlink — resolve to the real store dir first.
const wsSrc = fs.realpathSync(path.join(ROOT, "node_modules", "ws"));
const wsDest = path.join(RELAY, "wsdeps", "ws");
try { fs.rmSync(path.join(RELAY, "node_modules"), { recursive: true, force: true }); } catch {}
try { fs.rmSync(wsDest, { recursive: true, force: true }); } catch {}
fs.mkdirSync(path.dirname(wsDest), { recursive: true });
fs.cpSync(wsSrc, wsDest, { recursive: true, force: true });
console.log("[assemble] ws from", wsSrc);
console.log("[assemble] relay payload ready");

// --- 2b) App icon (PNG >=256px; electron-builder makes the .ico) ---
copyFile(path.join(ROOT, "public", "icon-512.png"), path.join(APP, "icon.png"));
console.log("[assemble] icon ready");

// --- 2c) Electron main process entry + preload (desktop keyboard marker) ---
copyFile(path.join(PACK, "main.cjs"), path.join(APP, "main.cjs"));
copyFile(path.join(PACK, "preload.cjs"), path.join(APP, "preload.cjs"));

// --- 3) Sanity summary ---
function sizeMB(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else total += fs.statSync(f).size;
    }
  };
  walk(p);
  return (total / 1048576).toFixed(1);
}
console.log(`[assemble] app payload: server ${sizeMB(SERVER)} MB`);
console.log("[assemble] done:", APP);
