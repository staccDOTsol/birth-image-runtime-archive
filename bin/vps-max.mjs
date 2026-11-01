// Mass-provision the non-TEE rail and put a guest on every new box.
// usage: node bin/vps-max.mjs [count]
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as P from '../lib/providers.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const N = Number(process.argv[2] || 8);
const PY = path.join(RUNTIME_DIR, 'dist', 'x4venv', 'Scripts', 'python.exe');

const provisioned = await Promise.all(Array.from({ length: N }, async (_, i) => {
  try {
    const r = await P.provisionX402Compute({ plan: process.env.X4_PLAN || 'vc2-1c-1gb', hours: Number(process.env.X4_HOURS || 24) });
    return { i, ok: !!r.id, id: r.id };
  } catch (e) { return { i, ok: false, err: String(e.message || e).slice(0, 90) }; }
}));
console.log(JSON.stringify({ at: now(), provisioned: provisioned.filter((x) => x.ok).length, failed: provisioned.filter((x) => !x.ok).length }));

await new Promise((x) => setTimeout(x, 60000));
let ips = [];
try {
  const out = execFileSync(PY, [path.join(RUNTIME_DIR, 'dist', 'list_instances.py')], { encoding: 'utf8', timeout: 90000 });
  ips = [...new Set((out.match(/IP: ([0-9.]+)/g) || []).map((x) => x.slice(4)))];
} catch {}
const silent = [];
for (const ip of ips) {
  try { const r = await fetch('http://' + ip + '/identity', { signal: AbortSignal.timeout(4000) }); if (r.ok) continue; } catch {}
  silent.push(ip);
}
console.log(JSON.stringify({ at: now(), ips: ips.length, silent: silent.length }));
if (silent.length) {
  const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'vps-fleet.mjs'), ...silent], { cwd: RUNTIME_DIR, timeout: 1200000, maxBuffer: 16 * 1024 * 1024 })
    .catch((e) => ({ stdout: String(e.message || e).slice(0, 200) }));
  console.log(stdout.trim().split('\n').slice(-30).join('\n'));
}
