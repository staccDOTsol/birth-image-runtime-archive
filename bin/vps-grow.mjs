// Grow the non-TEE rail: provision one x402compute VPS, wait for its IP, deploy the guest onto
// every instance that isn't answering yet. Meant to be run on a loop.
// usage: node bin/vps-grow.mjs [maxDeploy]
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as P from '../lib/providers.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const maxDeploy = Number(process.argv[2] || 3);
const PY = path.join(RUNTIME_DIR, 'dist', 'x4venv', 'Scripts', 'python.exe');

function listIps() {
  try {
    const out = execFileSync(PY, [path.join(RUNTIME_DIR, 'dist', 'list_instances.py')], { encoding: 'utf8', timeout: 90000 });
    return [...new Set((out.match(/IP: ([0-9.]+)/g) || []).map((x) => x.slice(4)))];
  } catch { return []; }
}

async function answers(ip) {
  try { const r = await fetch(`http://${ip}/identity`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
}

// 1) top up the rail if nothing is idle
let created = null;
try {
  const r = await P.provisionX402Compute({ plan: process.env.X4_PLAN || 'vc2-1c-1gb', hours: Number(process.env.X4_HOURS || 24) });
  created = r.id;
  console.log(JSON.stringify({ at: now(), provisioned: created, ip: r.ip || null }));
} catch (e) {
  console.log(JSON.stringify({ at: now(), provision_error: String(e.message || e).slice(0, 120) }));
}

// 2) give the provider a moment, then deploy onto anything silent
await new Promise((x) => setTimeout(x, Number(process.env.X4_WAIT_MS || 45000)));
const ips = listIps();
const silent = [];
for (const ip of ips) if (!(await answers(ip))) silent.push(ip);
console.log(JSON.stringify({ at: now(), instances: ips.length, silent: silent.length, deploying: silent.slice(0, maxDeploy) }));

if (silent.length) {
  const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'vps-fleet.mjs'), ...silent.slice(0, maxDeploy)], { cwd: RUNTIME_DIR, timeout: 900000, maxBuffer: 8 * 1024 * 1024 })
    .catch((e) => ({ stdout: JSON.stringify({ stage: 'deploy_error', err: String(e.message || e).slice(0, 120) }) }));
  console.log(stdout.trim().split('\n').slice(-8).join('\n'));
}
