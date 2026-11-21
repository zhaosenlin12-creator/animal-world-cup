// Desktop packaging build: produces a self-contained Next.js standalone server
// for embedding in the Electron app. Kept separate from the normal deploy build
// so the Cloudflare workflow is untouched.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const nft = path.join(ROOT, ".next", "server", "app", "_not-found", "page.js.nft.json");
const buildId = path.join(ROOT, ".next", "BUILD_ID");
const standaloneDir = path.join(ROOT, ".next", "standalone");

function ensureNft() {
  try {
    const dir = path.dirname(nft);
    if (fs.existsSync(dir) && !fs.existsSync(nft)) {
      fs.writeFileSync(nft, JSON.stringify({ version: 1, files: [] }));
    }
  } catch {}
}

const watcher = setInterval(ensureNft, 50);
const env = { ...process.env, ANIMALCUP_PACK: "1" };
const code = await new Promise((resolve) => {
  const p = spawn(NODE, ["node_modules/next/dist/bin/next", "build"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  p.on("exit", (c) => resolve(c ?? 0));
  p.on("error", () => resolve(1));
});
clearInterval(watcher);
ensureNft();

if (code !== 0 && !fs.existsSync(buildId)) {
  console.error("[pack-build] real build failure (no BUILD_ID)");
  process.exit(1);
}
if (!fs.existsSync(buildId)) {
  console.error("[pack-build] no BUILD_ID after build");
  process.exit(1);
}

// Verify standalone output exists.
if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  console.error("[pack-build] standalone server.js missing — output config not applied?");
  process.exit(1);
}
console.log("[pack-build] standalone build OK:", standaloneDir);
