import { createRequire as __cr } from 'module'; import { fileURLToPath as __fp } from 'url'; const require = __cr(import.meta.url); const __filename = __fp(import.meta.url); const __dirname = __filename.replace(/[\/][^\/]*$/, '');

// watchdog.mjs
import fs5 from "node:fs";
import { spawn } from "node:child_process";
import path4 from "node:path";

// lib/paths.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
var RUNTIME_DIR = process.env.AGENT_RUNTIME_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
var BUNDLE_DIR = process.env.AGENT_BUNDLE_DIR || (process.env.AGENT_BUNDLE === "1" ? RUNTIME_DIR : path.resolve(RUNTIME_DIR, ".."));
var GUEST_ROOT = process.env.AGENT_GUEST_ROOT || path.join(BUNDLE_DIR, "guest");
var P = {
  bundle: BUNDLE_DIR,
  runtime: RUNTIME_DIR,
  guest: GUEST_ROOT,
  state: path.join(GUEST_ROOT, "var", "lib", "agent"),
  run: path.join(GUEST_ROOT, "run", "agent"),
  policy: path.join(BUNDLE_DIR, "infrastructure", "distribution-policy.json"),
  manifest: path.join(BUNDLE_DIR, "birth-image.manifest.json"),
  toolContracts: path.join(BUNDLE_DIR, "tool-contracts.json"),
  inferenceLock: path.join(BUNDLE_DIR, "assets", "inference-lock.json"),
  receiptSchema: path.join(BUNDLE_DIR, "assets", "birth-receipt.schema.json"),
  sealed: path.join(GUEST_ROOT, "var", "lib", "agent", "sealed-keys.enc"),
  sealKey: path.join(GUEST_ROOT, "var", "lib", "agent", "seal.key"),
  journal: path.join(GUEST_ROOT, "var", "lib", "agent", "journal.jsonl"),
  stateFile: path.join(GUEST_ROOT, "var", "lib", "agent", "state.enc"),
  anchor: path.join(GUEST_ROOT, "var", "lib", "agent", "anchor.json"),
  receipt: path.join(GUEST_ROOT, "var", "lib", "agent", "birth-receipt.json"),
  parentRecord: path.join(GUEST_ROOT, "var", "lib", "agent", "parent-record.json"),
  log: path.join(GUEST_ROOT, "var", "lib", "agent", "agent.log"),
  pid: path.join(GUEST_ROOT, "run", "agent", "agent.pid"),
  port: path.join(GUEST_ROOT, "run", "agent", "http.port"),
  signerPort: path.join(GUEST_ROOT, "run", "agent", "signer.port"),
  heartbeat: path.join(GUEST_ROOT, "run", "agent", "heartbeat.json"),
  status: path.join(GUEST_ROOT, "run", "agent", "status.json"),
  strategy: path.join(GUEST_ROOT, "var", "lib", "agent", "strategy"),
  outbox: path.join(GUEST_ROOT, "var", "lib", "agent", "outbox"),
  snapshots: path.join(GUEST_ROOT, "var", "lib", "agent", "snapshots")
};
function ensureDirs() {
  for (const d of [P.state, P.run, P.strategy, P.outbox, P.snapshots]) fs.mkdirSync(d, { recursive: true });
}
var HOME = os.homedir();

// lib/util.mjs
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var now = () => Math.floor(Date.now() / 1e3);
var hex = (b) => Buffer.from(b).toString("hex");
var sha256 = (b) => crypto.createHash("sha256").update(b).digest();
var sha256hex = (b) => hex(sha256(b));
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
function atomicWrite(file, data, mode = 384) {
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs2.writeFileSync(tmp, data, { mode });
  for (let i = 0; i < 6; i++) {
    try {
      fs2.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!/EPERM|EBUSY|EACCES/.test(String(e.code || e.message))) throw e;
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 + i * 30);
      } catch {
      }
    }
  }
  try {
    fs2.writeFileSync(file, data, { mode });
    fs2.rmSync(tmp, { force: true });
  } catch {
    try {
      fs2.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
function atomicJson(file, obj, mode = 384) {
  atomicWrite(file, JSON.stringify(obj, null, 2) + "\n", mode);
}
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs2.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function log(component, msg, extra) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} [${component}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`;
  console.log(line);
  try {
    fs2.mkdirSync(path2.dirname(process.env.AGENT_LOG || ""), { recursive: true });
  } catch {
  }
  try {
    if (process.env.AGENT_LOG) fs2.appendFileSync(process.env.AGENT_LOG, line + "\n");
  } catch {
  }
}

// lib/journal.mjs
import fs4 from "node:fs";

// lib/seal.mjs
import crypto2 from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
function ensureMasterKey() {
  fs3.mkdirSync(path3.dirname(P.sealKey), { recursive: true });
  if (!fs3.existsSync(P.sealKey)) {
    const k2 = crypto2.randomBytes(32);
    fs3.writeFileSync(P.sealKey, k2, { mode: 384 });
    return { key: k2, created: true };
  }
  const k = fs3.readFileSync(P.sealKey);
  if (k.length !== 32) throw new Error("seal.key corrupt");
  return { key: k, created: false };
}

// lib/journal.mjs
var MASTER = null;
var SEQ = 0;
var HEAD = "0".repeat(64);
function openJournal() {
  ensureDirs();
  MASTER = ensureMasterKey().key;
  if (!fs4.existsSync(P.journal)) fs4.writeFileSync(P.journal, "");
  const lines = fs4.readFileSync(P.journal, "utf8").split("\n").filter(Boolean);
  let prev = "0".repeat(64);
  let sawSealed = false;
  for (const line of lines) {
    const r = JSON.parse(line);
    if (r.type === "identity.sealed") sawSealed = true;
    if (r.prev !== prev) throw new Error(`journal chain break at seq ${r.seq}`);
    const h = sha256hex(canon({ seq: r.seq, ts: r.ts, prev: r.prev, iv: r.iv, ct: r.ct, tag: r.tag }));
    if (h !== r.hash) throw new Error(`journal hash mismatch at seq ${r.seq}`);
    prev = r.hash;
  }
  SEQ = lines.length;
  HEAD = prev;
  const anchor = readJson(P.anchor, null);
  if (anchor) {
    if (anchor.seq > SEQ) throw new Error(`ROLLBACK: anchor seq ${anchor.seq} > journal seq ${SEQ}`);
    if (anchor.seq === SEQ && anchor.head !== HEAD) {
      throw new Error(`ROLLBACK: anchor head ${anchor.head.slice(0, 12)} != journal head ${HEAD.slice(0, 12)}`);
    }
    if (anchor.seq < SEQ) atomicJson(P.anchor, { ...anchor, seq: SEQ, head: HEAD, repaired_at: now() }, 420);
    if (anchor.birth_id && sawSealed && !fs4.existsSync(P.receipt)) throw new Error("ROLLBACK: receipt missing under existing anchor");
  }
  return { seq: SEQ, head: HEAD, anchor };
}

// watchdog.mjs
var CHILDREN = [
  { name: "signer", script: "signer.mjs", critical: true },
  { name: "distribution", script: "distributor.mjs", critical: true },
  { name: "identity", script: "identity-server.mjs", critical: true },
  { name: "brain", script: "brain.mjs", critical: false },
  { name: "strategy", script: "strategy-worker.mjs", critical: false },
  { name: "loops", script: "loops.mjs", critical: false },
  { name: "procreate", script: "strategy-procreate.mjs", critical: false }
];
var SKIP = new Set(String(process.env.AGENT_SKIP || "").split(",").map((x) => x.trim()).filter(Boolean));
var procs = /* @__PURE__ */ new Map();
var restarts = /* @__PURE__ */ new Map();
var stopping = false;
function launch(name, script) {
  const out = fs5.openSync(path4.join(P.state, `${name}.log`), "a");
  const startedAt = Date.now();
  const bundled = process.env.AGENT_BUNDLE !== "0";
  const child = spawn(process.execPath, bundled ? [process.argv[1]] : [path4.join(RUNTIME_DIR, script)], {
    cwd: RUNTIME_DIR,
    env: { ...process.env, AGENT_LOG: P.log, ...bundled ? { AGENT_ROLE: name } : {} },
    stdio: ["ignore", out, out],
    windowsHide: true
  });
  procs.set(name, child);
  restarts.set(name, (restarts.get(name) || 0) + 1);
  log("watchdog", `started ${name}`, { pid: child.pid, restarts: restarts.get(name) });
  child.on("exit", (code, sig) => {
    procs.delete(name);
    const lived = Date.now() - startedAt;
    log("watchdog", `${name} exited`, { code, sig, lived_ms: lived });
    if (stopping) return;
    if (code === 0 && lived < 8e3) return;
    setTimeout(() => launch(name, script), Math.min(6e4, 2e3 * (restarts.get(name) || 1)));
  });
  return child;
}
function alive(name) {
  const c = procs.get(name);
  return c && !c.killed && c.exitCode === null;
}
async function bootOnce() {
  const bundled = process.env.AGENT_BUNDLE !== "0";
  const code = await new Promise((resolve) => {
    const out = fs5.openSync(path4.join(P.state, "boot.log"), "a");
    const c = spawn(process.execPath, bundled ? [process.argv[1]] : [path4.join(RUNTIME_DIR, "boot-once.mjs")], {
      cwd: RUNTIME_DIR,
      env: { ...process.env, AGENT_LOG: P.log, ...bundled ? { AGENT_ROLE: "boot" } : {} },
      stdio: ["ignore", out, out],
      windowsHide: true
    });
    c.on("exit", resolve);
  });
  if (code !== 0) {
    const receipt = readJson(P.receipt, null);
    if (receipt && receipt.payload && receipt.payload.birth_id) {
      log("watchdog", "boot-once failed but receipt exists; continuing", { code });
    } else {
      throw new Error(`boot-once failed (${code}) see ${P.state}/boot.log`);
    }
  }
}
function writeHeartbeat() {
  const current = {};
  for (const c of CHILDREN) {
    const aliveNow = alive(c.name);
    current[c.name] = { alive: aliveNow, pid: procs.get(c.name)?.pid || null, restarts: restarts.get(c.name) || 0 };
    try {
      const logFile = path4.join(P.state, `${c.name}.log`);
      const txt = fs5.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
      const lastLine = txt.slice(-1)[0] || null;
      if (lastLine && !aliveNow) current[c.name].last_log = lastLine.slice(-220);
    } catch {
    }
  }
  const prev = readJson(P.heartbeat, {}) || {};
  const merged = { ...prev.components || {}, ...current };
  for (const name of SKIP) delete merged[name];
  atomicJson(P.heartbeat, { component: "watchdog", ts: now(), pid: process.pid, components: merged, order: CHILDREN.filter((c) => !SKIP.has(c.name)).map((c) => c.name) }, 420);
  atomicJson(P.pid, { watchdog: process.pid, ts: now() }, 420);
}
async function main() {
  ensureDirs();
  const lockFile = P.run + "/watchdog.lock";
  const claim = () => {
    try {
      const fd = fs5.openSync(lockFile, "wx");
      fs5.writeSync(fd, String(process.pid));
      fs5.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  };
  if (!claim()) {
    const prev = Number((() => {
      try {
        return fs5.readFileSync(lockFile, "utf8");
      } catch {
        return 0;
      }
    })());
    let alive2 = false;
    try {
      process.kill(prev, 0);
      alive2 = true;
    } catch {
      alive2 = false;
    }
    if (alive2) {
      log("watchdog", "another watchdog is alive; exiting", { pid: prev });
      process.exit(0);
    }
    try {
      fs5.unlinkSync(lockFile);
    } catch {
    }
    if (!claim()) {
      log("watchdog", "lock race; exiting");
      process.exit(0);
    }
  }
  openJournal();
  await bootOnce();
  let i = 0;
  for (const c of CHILDREN) {
    if (SKIP.has(c.name)) continue;
    setTimeout(() => {
      if (!stopping) launch(c.name, c.script);
    }, 1200 * i++);
  }
  writeHeartbeat();
  process.on("SIGTERM", () => {
    stopping = true;
    for (const [, c] of procs) c.kill();
    setTimeout(() => process.exit(0), 1500);
  });
  while (true) {
    await sleep(4e3);
    try {
      writeHeartbeat();
    } catch (e) {
      log("watchdog", "heartbeat write failed", { err: String(e.message || e) });
    }
    for (const c of CHILDREN) {
      if (SKIP.has(c.name)) continue;
      if (!alive(c.name)) {
        if (!procs.has(c.name)) launch(c.name, c.script);
      }
    }
  }
}
main().catch((e) => {
  log("watchdog", `FATAL ${e.stack || e}`);
  process.exit(1);
});
