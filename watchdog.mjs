// Process supervisor. Runs boot-once, then keeps the fixed workers alive. Restarting
// a worker replays its journal; it never changes the constitution, rates or schedule.
// The distributor is started before the strategy worker, as the policy requires.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { P, RUNTIME_DIR, ensureDirs } from './lib/paths.mjs';
import { readJson, atomicJson, now, log, sleep } from './lib/util.mjs';
import * as J from './lib/journal.mjs';

const CHILDREN = [
  { name: 'signer', script: 'signer.mjs', critical: true },
  { name: 'distribution', script: 'distributor.mjs', critical: true },
  { name: 'identity', script: 'identity-server.mjs', critical: true },
  { name: 'brain', script: 'brain.mjs', critical: false },
  { name: 'strategy', script: 'strategy-worker.mjs', critical: false },
  { name: 'loops', script: 'loops.mjs', critical: false },
  { name: 'procreate', script: 'strategy-procreate.mjs', critical: false },
];

const SKIP = new Set(String(process.env.AGENT_SKIP || '').split(',').map((x) => x.trim()).filter(Boolean));
const procs = new Map();
const restarts = new Map();
let stopping = false;

function launch(name, script) {
  const out = fs.openSync(path.join(P.state, `${name}.log`), 'a');
  const startedAt = Date.now();
  const bundled = process.env.AGENT_BUNDLE === '1';
  const child = spawn(process.execPath, bundled ? [process.argv[1]] : [path.join(RUNTIME_DIR, script)], {
    cwd: RUNTIME_DIR,
    env: { ...process.env, AGENT_LOG: P.log, ...(bundled ? { AGENT_ROLE: name } : {}) },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  procs.set(name, child);
  restarts.set(name, (restarts.get(name) || 0) + 1);
  log('watchdog', `started ${name}`, { pid: child.pid, restarts: restarts.get(name) });
  child.on('exit', (code, sig) => {
    procs.delete(name);
    const lived = Date.now() - startedAt;
    log('watchdog', `${name} exited`, { code, sig, lived_ms: lived });
    if (stopping) return;
    // A clean, very short exit means the worker found the job already done (e.g. another
    // identity server serving). Do not hot-loop on it.
    if (code === 0 && lived < 8000) return;
    setTimeout(() => launch(name, script), Math.min(60000, 2000 * (restarts.get(name) || 1)));
  });
  return child;
}

function alive(name) { const c = procs.get(name); return c && !c.killed && c.exitCode === null; }

async function bootOnce() {
  const bundled = process.env.AGENT_BUNDLE === '1';
  const code = await new Promise((resolve) => {
    const out = fs.openSync(path.join(P.state, 'boot.log'), 'a');
    const c = spawn(process.execPath, bundled ? [process.argv[1]] : [path.join(RUNTIME_DIR, 'boot-once.mjs')], {
      cwd: RUNTIME_DIR, env: { ...process.env, AGENT_LOG: P.log, ...(bundled ? { AGENT_ROLE: 'boot' } : {}) }, stdio: ['ignore', out, out], windowsHide: true,
    });
    c.on('exit', resolve);
  });
  if (code !== 0) {
    // boot-once is idempotent by intent: a guest that already holds a sealed receipt must still
    // start its workers, otherwise a second boot on a dirty state dir leaves the box deaf.
    const receipt = readJson(P.receipt, null);
    if (receipt && receipt.payload && receipt.payload.birth_id) {
      log('watchdog', 'boot-once failed but receipt exists; continuing', { code });
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
      const logFile = path.join(P.state, `${c.name}.log`);
      const txt = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      const lastLine = txt.slice(-1)[0] || null;
      if (lastLine && !aliveNow) current[c.name].last_log = lastLine.slice(-220);
    } catch {}
  }
  const prev = readJson(P.heartbeat, {}) || {};
  // skipPrune: never report a worker we deliberately do not run
  const merged = { ...(prev.components || {}), ...current };
  for (const name of SKIP) delete merged[name];
  atomicJson(P.heartbeat, { component: 'watchdog', ts: now(), pid: process.pid, components: merged, order: CHILDREN.filter((c) => !SKIP.has(c.name)).map((c) => c.name) }, 0o644);
  atomicJson(P.pid, { watchdog: process.pid, ts: now() }, 0o644);
}

async function main() {
  ensureDirs();
  // Single instance: claim the lock atomically, or exit if a live watchdog owns it.
  const lockFile = P.run + '/watchdog.lock';
  const claim = () => {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch { return false; }
  };
  if (!claim()) {
    const prev = Number((() => { try { return fs.readFileSync(lockFile, 'utf8'); } catch { return 0; } })());
    let alive = false;
    try { process.kill(prev, 0); alive = true; } catch { alive = false; }
    if (alive) { log('watchdog', 'another watchdog is alive; exiting', { pid: prev }); process.exit(0); }
    try { fs.unlinkSync(lockFile); } catch {}
    if (!claim()) { log('watchdog', 'lock race; exiting'); process.exit(0); }
  }
  J.openJournal(); // fails fast on rollback evidence
  await bootOnce();
  for (const c of CHILDREN) { if (!SKIP.has(c.name)) launch(c.name, c.script); }
  writeHeartbeat();

  process.on('SIGTERM', () => {
    stopping = true;
    for (const [, c] of procs) c.kill();
    setTimeout(() => process.exit(0), 1500);
  });

  while (true) {
    await sleep(4000);
    try { writeHeartbeat(); } catch (e) { log('watchdog', 'heartbeat write failed', { err: String(e.message || e) }); }
    for (const c of CHILDREN) { if (SKIP.has(c.name)) continue;
      if (!alive(c.name)) {
        // exit handler restarts, but cover the case where it never registered
        if (!procs.has(c.name)) launch(c.name, c.script);
      }
    }
  }
}

main().catch((e) => { log('watchdog', `FATAL ${e.stack || e}`); process.exit(1); });
