// Isolated standalone build.
// Root cause: the main tree uses pnpm's symlinked node_modules; Next's
// standalone tracer fails to recreate those symlinks on Windows (errno -4094),
// so server.js never gets written. Fix: build in an isolated dir with a flat
// npm install (no symlinks), then sync the standalone output back.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISO = path.join(ROOT, process.env.PACK_ISO_DIR || ".packbuild");
const NODE = process.execPath;
const NPM = "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js";
const REG = "https://registry.npmmirror.com";

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  // Clear read-only bits first (a failed build can leave locked/RO trace files).
  try { execFileSync("attrib", ["-R", path.join(p, "*.*"), "/S", "/D"], { stdio: "ignore" }); } catch {}
  let last;
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(p, { recursive: true, force: true }); return; }
    catch (e) { last = e; }
    // brief busy-wait (no timer dependency) then retry
    const t = Date.now(); while (Date.now() - t < 400) {}
  }
  throw last;
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
}

function run(label, file, args, cwd, env) {
  return new Promise((resolve) => {
    console.log(`\n[isolated] ${label} ...`);
    const p = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    p.on("exit", (c) => resolve(c ?? 0));
    p.on("error", () => resolve(1));
  });
}

// --- 1) Prepare isolated source tree (flat npm deps) ---
rmrf(path.join(ISO, ".next"));
copyDir(path.join(ROOT, "app"), path.join(ISO, "app"));
copyDir(path.join(ROOT, "public"), path.join(ISO, "public"));
// app/* imports the root-level online/shared module via ../online/shared.
copyDir(path.join(ROOT, "online"), path.join(ISO, "online"));
for (const f of ["jsconfig.json", "next-env.d.ts"]) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(ISO, f));
}
// Inject outputFileTracingRoot so Next doesn't mistake the parent pnpm
// lockfile for the workspace root (which reintroduces symlink tracing).
let cfg = fs.readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
cfg = cfg.replace(
  "const nextConfig = {",
  "const nextConfig = {\n  outputFileTracingRoot: process.cwd(),",
);
fs.writeFileSync(path.join(ISO, "next.config.mjs"), cfg);

const pkg = {
  name: "animal-cup-pack",
  version: "1.0.0",
  private: true,
  scripts: {},
  dependencies: {
    next: "15.5.19",
    qrcode: "1.5.4",
    react: "19.2.7",
    "react-dom": "19.2.7",
  },
  devDependencies: {
    "@types/react": "19.2.17",
    sharp: "0.34.5",
    typescript: "5.8.2",
  },
};
fs.writeFileSync(path.join(ISO, "package.json"), JSON.stringify(pkg, null, 2));

const procEnv = { PATH: "C:/Program Files/nodejs;" + (process.env.PATH || "") };

// --- 2) npm install (flat, no symlinks) unless already present ---
if (!fs.existsSync(path.join(ISO, "node_modules", "next", "package.json"))) {
  const code = await run(
    "npm install (flat)",
    NODE,
    [NPM, "install", "--registry=" + REG, "--no-audit", "--no-fund"],
    ISO,
    procEnv,
  );
  if (code !== 0) { console.error("[isolated] npm install failed"); process.exit(1); }
} else {
  console.log("[isolated] node_modules present, skip install");
}

// --- 3) next build with standalone output ---
const nft = path.join(ISO, ".next", "server", "app", "_not-found", "page.js.nft.json");
const buildId = path.join(ISO, ".next", "BUILD_ID");
function ensureNft() {
  try {
    const dir = path.dirname(nft);
    if (fs.existsSync(dir) && !fs.existsSync(nft)) {
      fs.writeFileSync(nft, JSON.stringify({ version: 1, files: [] }));
    }
  } catch {}
}
const watcher = setInterval(ensureNft, 50);
const code = await run(
  "next build (standalone)",
  NODE,
  ["node_modules/next/dist/bin/next", "build"],
  ISO,
  { ANIMALCUP_PACK: "1", NODE_ENV: "production", ...procEnv },
);
clearInterval(watcher);
ensureNft();

if (!fs.existsSync(path.join(ISO, ".next", "standalone", "server.js"))) {
  console.error("[isolated] standalone server.js missing; BUILD_ID=" + fs.existsSync(buildId));
  process.exit(1);
}

// --- 4) Sync standalone + static back into main .next for the assembler ---
const destNext = path.join(ROOT, ".next");
fs.mkdirSync(destNext, { recursive: true });
console.log("[isolated] syncing standalone output back to main .next ...");
copyDir(path.join(ISO, ".next", "standalone"), path.join(destNext, "standalone"));
copyDir(path.join(ISO, ".next", "static"), path.join(destNext, "static"));
fs.copyFileSync(buildId, path.join(destNext, "BUILD_ID"));
console.log("[isolated] DONE. standalone synced to", path.join(destNext, "standalone"));
