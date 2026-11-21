// Verify a built exe actually boots all services and serves the game.
// Usage: node verify.mjs <path-to-exe>
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error("usage: node verify.mjs <path-to-exe>");
  process.exit(1);
}

// The agent host injects ELECTRON_RUN_AS_NODE=1; a real double-click does not.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const proc = spawn(exe, [], { stdio: ["ignore", "pipe", "pipe"], env });
proc.stdout.on("data", (b) => process.stdout.write("[app] " + b));
proc.stderr.on("data", (b) => process.stdout.write("[app:err] " + b));

function portOpen(port, host, ms = 800) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.destroy(); resolve(v); };
    s.setTimeout(ms);
    s.once("connect", () => finish(true));
    s.once("error", () => finish(false));
    s.once("timeout", () => finish(false));
  });
}
async function waitPort(port, host, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await portOpen(port, host)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
async function httpGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch (e) { return { status: 0, body: e.message }; }
}

function killTree(pid) {
  try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
}

const results = [];
try {
  // Wait for all three ports concurrently with a generous window.
  const [ok13000, ok13001, ok13002] = await Promise.all([
    waitPort(13000, "127.0.0.1", 90000),
    waitPort(13001, "127.0.0.1", 90000),
    waitPort(13002, "127.0.0.1", 90000),
  ]);
  results.push(["13000 web server", ok13000]);
  results.push(["13001 LAN relay", ok13001]);
  results.push(["13002 room relay", ok13002]);

  const health = ok13000 ? await httpGet("http://127.0.0.1:13000/api/health") : { status: 0, body: "-" };
  results.push(["health endpoint", health.status === 200 && /ok/.test(health.body)]);
  const home = ok13000 ? await httpGet("http://127.0.0.1:13000/") : { status: 0, body: "-" };
  results.push(["home page", home.status === 200 && home.body.length > 0]);
} finally {
  killTree(proc.pid);
  await new Promise((r) => setTimeout(r, 500));
}

let pass = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
