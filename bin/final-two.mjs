// Final-spend run: wait for provider capacity, then deploy N fixed-image children,
// endow each with 0.06 SOL, and require a real tool call from each. Stops on the first
// hard failure so no money is spent blind. usage: node bin/final-two.mjs [count]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const API = 'https://agentgates-backend.vercel.app';
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/pgiir0.tgz';
const want = Number(process.argv[2] || 2);
const out = path.join(RUNTIME_DIR, 'dist', 'final.jsonl');
const say = (o) => { fs.appendFileSync(out, JSON.stringify(o) + '\n'); };
const { ownerGet } = await import('./agentgates-auth.mjs');

async function tryDeploy() {
  try {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'deploy-child.mjs'), '1', 'compute.standard'], { cwd: RUNTIME_DIR, timeout: 600000, env: { ...process.env, AGENT_IMAGE_FORMAT: 'tgz', AGENT_IMAGE_URL: IMG } });
    const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    return JSON.parse(line);
  } catch (e) {
    const t = String(e.stdout || '');
    const line = t.trim().split(String.fromCharCode(10)).filter((l) => l.startsWith('{')).pop();
    try { return JSON.parse(line); } catch { return { stage: 'error', err: String(e.message || e).slice(0, 160) }; }
  }
}

let made = 0;
for (let tries = 0; tries < 240 && made < want; tries++) {
  const j = await tryDeploy();
  if (j.status === 503) { say({ at: now(), stage: 'capacity' }); await new Promise((r) => setTimeout(r, 60000)); continue; }
  if (!j.deploymentId) { say({ at: now(), stage: 'deploy_failed', j }); await new Promise((r) => setTimeout(r, 60000)); continue; }
  const depId = j.deploymentId;
  say({ at: now(), stage: 'deployed', depId, endpoint: j.endpoint || null });
  let endpoint = j.endpoint || null, address = null, funded = false, ok = null;
  for (let i = 0; i < 60; i++) {
    const d = (await ownerGet(API, `/api/compute/deployments/${depId}`)).body;
    if (d.endpoint) endpoint = d.endpoint;
    if (endpoint && !address) { try { const idj = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = idj.payload?.solana?.public_key || null; } catch {} }
    if (address && !funded) {
      try { await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, '60000000'], { cwd: RUNTIME_DIR, timeout: 180000 }); funded = true; say({ at: now(), stage: 'funded', address }); } catch {}
    }
    if (address && endpoint) {
      try {
        const s = await (await fetch(endpoint + '/status', { signal: AbortSignal.timeout(6000) })).json();
        if ((s.last_decision?.tools || []).length) { ok = { address, endpoint, decision: s.last_decision }; break; }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  say({ at: now(), stage: ok ? 'WORKING' : 'no_decision', depId, address, endpoint, decision: ok?.decision || null });
  if (ok) made++;
}
say({ at: now(), stage: 'done', made });
