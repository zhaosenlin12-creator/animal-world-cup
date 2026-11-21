/*
 * Serial, single-connection uploader for GitHub Release assets.
 * Success is determined ONLY by server-side state (state=uploaded + size match),
 * never by the client HTTP response (which can time out after a successful upload).
 * Resumable: skips already-completed assets; removes stale "starter" placeholders.
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = "zhaosenlin12-creator/animal-world-cup";
const RID = 453536541;
const DIR = "pack/parts8";
const CURL = "C:/Windows/System32/curl.exe";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GH_TOKEN missing");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const targets = [];
for (const m of manifest) {
  for (const p of m.parts) {
    targets.push({ name: p, size: fs.statSync(path.join(DIR, p)).size });
  }
}
targets.push({ name: "restore.cmd", size: fs.statSync(path.join(DIR, "restore.cmd")).size });

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);
const sleep = (ms) => spawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);

function ghJson(args, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const out = execFileSync("gh", args, { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
      return out;
    } catch (e) {
      if (i === retries - 1) return null;
      sleep(3000);
    }
  }
  return null;
}

function listAssets() {
  // NOTE: keep this jq expression free of backslash escapes. A previous
  // version used "\(.name)" inside a JS string, where "\(" collapses to "(",
  // turning the interpolation into literal text and breaking parsing.
  const out = ghJson([
    "api", `repos/${REPO}/releases/${RID}/assets`,
    "--jq", "[.[] | {name, size, state, id}]",
  ]);
  if (out === null) return null;
  try {
    return JSON.parse(out).map((a) => ({
      name: a.name, size: Number(a.size), state: a.state, id: a.id,
    }));
  } catch (e) {
    return null;
  }
}

function deleteAsset(id) {
  ghJson(["api", "-X", "DELETE", `repos/${REPO}/releases/assets/${id}`], 3);
}

function uploadOne(name) {
  const hdr = path.join(DIR, "._cur.hdr");
  const body = path.join(DIR, "._cur.body");
  const url = `https://uploads.github.com/repos/${REPO}/releases/${RID}/assets?name=${encodeURIComponent(name)}`;
  const r = spawnSync(CURL, [
    "-sS", "--http1.1", "--tcp-nodelay",
    "--connect-timeout", "20", "--max-time", "600",
    "-H", "Expect:",
    "-o", body, "-D", hdr,
    "-w", "%{http_code}",
    "-X", "POST", url,
    "-H", "Authorization: Bearer " + TOKEN,
    "-H", "Accept: application/vnd.github+json",
    "-H", "Content-Type: application/octet-stream",
    "--data-binary", "@" + path.join(DIR, name),
  ], { encoding: "utf8", timeout: 630000, maxBuffer: 4 * 1024 * 1024 });
  const code = (r.stdout || "").trim();
  return code === "201";
}

function serverHas(name, size) {
  const assets = listAssets();
  if (!assets) return "unknown";
  const a = assets.find((x) => x.name === name);
  if (a && a.state === "uploaded" && a.size === size) return true;
  if (a) return "stale";
  return false;
}

async function main() {
  // Clean up any non-target junk (probes, old 24MB parts) before starting.
  const wanted = new Set(targets.map((t) => t.name));
  const initial = listAssets();
  if (initial) {
    for (const a of initial) {
      if (!wanted.has(a.name)) {
        deleteAsset(a.id);
        log("removed non-target asset", a.name);
      }
    }
  }

  log(`targets=${targets.length} total=${(targets.reduce((s, t) => s + t.size, 0) / 1048576).toFixed(1)}MB`);
  let done = 0;
  const failures = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const pre = serverHas(t.name, t.size);
    if (pre === true) {
      done++;
      log(`SKIP  ${i + 1}/${targets.length} ${t.name} (already uploaded)`);
      continue;
    }
    if (pre === "stale") {
      const assets = listAssets();
      const a = assets && assets.find((x) => x.name === t.name);
      if (a) deleteAsset(a.id);
    }

    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      log(`UP    ${i + 1}/${targets.length} ${t.name} attempt=${attempt}`);
      const clientOk = uploadOne(t.name);
      const srv = serverHas(t.name, t.size);
      if (srv === true) {
        ok = true;
        done++;
        log(`OK    ${i + 1}/${targets.length} ${t.name} (client=${clientOk ? "201" : "lost-response"})`);
      } else {
        if (srv === "stale") {
          const assets = listAssets();
          const a = assets && assets.find((x) => x.name === t.name);
          if (a) deleteAsset(a.id);
        }
        log(`RETRY ${i + 1}/${targets.length} ${t.name} (client=${clientOk ? "201" : "fail"}, server=${srv})`);
      }
    }
    if (!ok) failures.push(t.name);
  }

  log(`=== FINAL done=${done}/${targets.length} failed=${failures.length} ===`);
  if (failures.length) log("FAILED:", failures.join(", "));

  // Final verification against server state.
  const final = listAssets();
  const verified = [];
  if (final) {
    for (const t of targets) {
      const a = final.find((x) => x.name === t.name);
      verified.push({ name: t.name, ok: !!(a && a.state === "uploaded" && a.size === t.size) });
    }
  }
  const bad = verified.filter((v) => !v.ok);
  log(`=== VERIFY verified=${verified.length - bad.length}/${targets.length} missing=${bad.length} ===`);
  fs.writeFileSync(path.join(DIR, "upload-final.json"), JSON.stringify({ targets: targets.length, failures, verified }, null, 2));
  process.exit(bad.length || failures.length ? 1 : 0);
}

main();
