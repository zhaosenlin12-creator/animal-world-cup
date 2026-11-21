/*
 * Two-layer, download-free verification of the split release assets.
 *
 * Layer 1: for every uploaded asset, GitHub's server-computed `digest`
 *          (sha256:...) must equal the local part's SHA-256, and sizes
 *          must match. This proves every byte arrived intact.
 * Layer 2: concatenating the local parts in manifest order must reproduce
 *          the original exe's SHA-256. This proves the restore.cmd order
 *          is correct and the user gets the exact original installer.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const assetsFile = "pack/.assets-full.json";
const partsDir = "pack/parts8";
const distDir = "pack/dist";

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const assets = JSON.parse(fs.readFileSync(assetsFile, "utf8"));
const man = JSON.parse(fs.readFileSync(path.join(partsDir, "manifest.json"), "utf8"));
const byName = {};
for (const a of assets) byName[a.name] = a;

let fail = 0;

// ---- Layer 1: server digest vs local part bytes ----
const wanted = [];
for (const m of man) for (const p of m.parts) wanted.push(p);
wanted.push("restore.cmd");

for (const name of wanted) {
  const a = byName[name];
  const local = fs.readFileSync(path.join(partsDir, name));
  const localHash = sha(local);
  const serverDigest = a && a.digest ? String(a.digest).replace(/^sha256:/, "") : null;
  const sizeOk = a && a.size === local.length;
  const digestOk = serverDigest && serverDigest === localHash;
  const stateOk = a && a.state === "uploaded";
  if (!(sizeOk && digestOk && stateOk)) {
    fail++;
    console.log(`MISMATCH ${name}: state=${a && a.state} size=${a && a.size}/${local.length} digest=${serverDigest ? serverDigest.slice(0, 12) : "none"} local=${localHash.slice(0, 12)}`);
  }
}
console.log(`Layer1: ${wanted.length - fail}/${wanted.length} parts byte-verified against server digest`);

// ---- Layer 2: reassemble from parts -> original exe hash ----
let layer2 = 0;
for (const m of man) {
  const merged = Buffer.concat(m.parts.map((p) => fs.readFileSync(path.join(partsDir, p))));
  const orig = fs.readFileSync(path.join(distDir, m.file));
  const same = merged.length === orig.length && sha(merged) === sha(orig);
  if (same) layer2++;
  else { fail++; console.log(`REASSEMBLE FAIL ${m.file}`); }
  console.log(`  ${m.file}: ${same ? "OK" : "FAIL"}  assembled=${merged.length} sha256=${sha(merged)}`);
}
console.log(`Layer2: ${layer2}/${man.length} exes reproduced exactly from parts`);

console.log(`=== RESULT ${fail === 0 ? "ALL VERIFIED" : "FAILED(" + fail + ")"} ===`);
process.exit(fail === 0 ? 0 : 1);
